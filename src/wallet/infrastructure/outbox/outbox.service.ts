import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull, In, DataSource } from 'typeorm';
import { OutboxEvent } from './outbox.entity';
import { DebugCaptureService } from '../../../integration/application/debug-capture.service';

export interface OutboxMessage {
  id: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: Record<string, any>;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface EnqueueOptions {
  aggregateId: string;
  correlationId?: string;
  causationId?: string;
  [key: string]: any;
}

export interface ClaimBatchOptions {
  size: number;
  consumer: string;
  olderThan?: Date;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly dataSource: DataSource,
    private readonly debugCapture: DebugCaptureService,
  ) {}

  /**
   * Enqueue domain events to the outbox for async processing
   * @param events Domain events to enqueue
   * @param options Metadata options (aggregateId, correlationId, etc.)
   */
  async enqueue(
    events: any[],
    options: EnqueueOptions,
  ): Promise<void> {
    if (!events || events.length === 0) {
      return;
    }

    const outboxEvents = events.map((event, index) => {
      const outboxEvent = new OutboxEvent();
      outboxEvent.aggregateId = options.aggregateId;
      outboxEvent.eventType = event.type || event.constructor.name;
      outboxEvent.eventVersion = event.metadata?.version ?? index;
      outboxEvent.payload = this.serializeEvent(event);
      outboxEvent.metadata = {
        correlationId: options.correlationId,
        causationId: options.causationId,
        timestamp: new Date().toISOString(),
        ...event.metadata,
      };
      return outboxEvent;
    });

    try {
      await this.outboxRepo.insert(outboxEvents);
      this.logger.debug(
        `Enqueued ${events.length} events for aggregate ${options.aggregateId}`,
      );
    } catch (error) {
      // Handle duplicate key errors gracefully (idempotency)
      if (error.code === '23505') {
        this.logger.warn(
          `Duplicate outbox events detected for aggregate ${options.aggregateId} - ignoring`,
        );
        return;
      }
      this.logger.error('Failed to enqueue events to outbox', error);
      await this.debugCapture.writeCapture({
        source: 'outbox-service',
        type: 'enqueue_error',
        error: { message: error.message, stack: error.stack },
        payload: { eventsCount: events.length },
        metadata: { aggregateId: options.aggregateId },
      });
      throw error;
    }
  }

  /**
   * Claim a batch of unprocessed events for a specific consumer
   * Uses optimistic locking approach for concurrent workers
   * Multiple consumers can process the same event independently
   * @param options Batch size, consumer name, and optional time filter
   * @returns Array of outbox messages
   */
  async claimBatch(options: ClaimBatchOptions): Promise<OutboxMessage[]> {
    const { size, consumer, olderThan } = options;

    // Use raw SQL with FOR UPDATE SKIP LOCKED for proper concurrent handling
    return this.dataSource.transaction(async (manager) => {
      let whereClause = `o.id NOT IN (
        SELECT outbox_event_id 
        FROM outbox_consumer_processing 
        WHERE consumer_name = $${olderThan ? 3 : 2}
      )`;
      const params: any[] = [size];
      
      if (olderThan) {
        whereClause += ' AND o.created_at < $2';
        params.push(olderThan);
      }

      params.push(consumer);

      // Raw query with FOR UPDATE SKIP LOCKED for concurrent workers
      // Only fetch events that this consumer hasn't processed yet
      const query = `
        SELECT o.* FROM outbox o
        WHERE ${whereClause}
        ORDER BY o.id ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `;

      const events = await manager.query(query, params);

      if (events.length === 0) {
        return [];
      }

      // Mark as claimed by updating consumer field (for backward compatibility)
      const eventIds = events.map((e: any) => e.id);
      await manager.query(
        `UPDATE outbox SET consumer = $1 WHERE id = ANY($2)`,
        [consumer, eventIds],
      );

      this.logger.debug(
        `Claimed ${events.length} events for consumer ${consumer}`,
      );

      // Convert raw results to OutboxMessage format
      return events.map((event: any) => ({
        id: event.id.toString(),
        aggregateId: event.aggregate_id,
        eventType: event.event_type,
        eventVersion: event.event_version,
        payload: event.payload,
        metadata: event.metadata,
        createdAt: event.created_at,
      }));
    });
  }

  /**
   * Mark an event as processed by a specific consumer
   * @param eventId Outbox event ID
   * @param consumer Consumer name
   */
  async markProcessed(eventId: string, consumer: string): Promise<void> {
    // Insert into consumer processing table
    await this.dataSource.query(
      `
      INSERT INTO outbox_consumer_processing (outbox_event_id, consumer_name, processed_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (outbox_event_id, consumer_name) DO NOTHING
      `,
      [eventId, consumer],
    );

    // Also update the main outbox table for backward compatibility
    await this.outboxRepo.update(
      { id: eventId },
      { processedAt: new Date(), consumer },
    );
  }

  /**
   * Mark multiple events as processed in a batch by a specific consumer
   * @param eventIds Array of outbox event IDs
   * @param consumer Consumer name
   */
  async markBatchProcessed(
    eventIds: string[],
    consumer: string,
  ): Promise<void> {
    if (eventIds.length === 0) return;

    // Insert into consumer processing table
    const values = eventIds.map((id) => `(${id}, '${consumer}', NOW())`).join(',');
    await this.dataSource.query(`
      INSERT INTO outbox_consumer_processing (outbox_event_id, consumer_name, processed_at)
      VALUES ${values}
      ON CONFLICT (outbox_event_id, consumer_name) DO NOTHING
    `);

    // Also update the main outbox table for backward compatibility
    await this.outboxRepo.update(
      { id: In(eventIds) },
      { processedAt: new Date(), consumer },
    );

    this.logger.debug(
      `Marked ${eventIds.length} events as processed for consumer ${consumer}`,
    );
  }

  /**
   * Get count of unprocessed events
   * @param consumer Optional consumer filter
   */
  async getUnprocessedCount(consumer?: string): Promise<number> {
    const query = this.outboxRepo
      .createQueryBuilder('outbox')
      .where('outbox.processed_at IS NULL');

    if (consumer) {
      query.andWhere('outbox.consumer = :consumer', { consumer });
    }

    return query.getCount();
  }

  /**
   * Get outbox lag (age of oldest unprocessed event)
   * @returns Age in milliseconds
   */
  async getOutboxLag(): Promise<number> {
    const oldest = await this.outboxRepo.findOne({
      where: { processedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });

    if (!oldest) {
      return 0;
    }

    return Date.now() - oldest.createdAt.getTime();
  }

  /**
   * Cleanup old processed events (retention policy)
   * @param olderThanDays Delete events older than X days
   */
  async cleanup(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.outboxRepo.delete({
      processedAt: LessThan(cutoffDate),
    });

    this.logger.log(
      `Cleaned up ${result.affected || 0} outbox events older than ${olderThanDays} days`,
    );

    return result.affected || 0;
  }

  /**
   * Get events for a specific aggregate (useful for debugging)
   * @param aggregateId Aggregate ID
   */
  async getEventsByAggregate(aggregateId: string): Promise<OutboxMessage[]> {
    const events = await this.outboxRepo.find({
      where: { aggregateId },
      order: { eventVersion: 'ASC' },
    });

    return events.map(this.toOutboxMessage);
  }

  private serializeEvent(event: any): Record<string, any> {
    // Remove circular references and functions
    return JSON.parse(JSON.stringify(event));
  }

  private toOutboxMessage(event: OutboxEvent): OutboxMessage {
    return {
      id: event.id,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      payload: event.payload,
      metadata: event.metadata,
      createdAt: event.createdAt,
    };
  }
}

