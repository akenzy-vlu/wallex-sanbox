import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxService } from '../wallet/infrastructure/outbox/outbox.service';
import { KafkaProducerService } from './kafka-producer.service';
import { DebugCaptureService } from '../integration/application/debug-capture.service';

@Injectable()
export class KafkaOutboxPublisherService implements OnModuleInit {
  private readonly logger = new Logger(KafkaOutboxPublisherService.name);
  private isRunning = false;
  private readonly batchSize = 100;
  private readonly consumerName = 'kafka-publisher';

  constructor(
    private readonly outboxService: OutboxService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly debugCapture: DebugCaptureService,
  ) {}

  async onModuleInit() {
    // Start immediately on module init
    this.logger.log('KafkaOutboxPublisher initialized');
    await this.publishOutboxEvents();
  }

  /**
   * Publish outbox events to Kafka every 5 seconds
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async publishOutboxEvents(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      let totalPublished = 0;
      let hasMore = true;

      while (hasMore) {
        // Claim batch of outbox events
        const batch = await this.outboxService.claimBatch({
          size: this.batchSize,
          consumer: this.consumerName,
        });

        if (batch.length === 0) {
          hasMore = false;
          break;
        }

        this.logger.debug(`Publishing ${batch.length} outbox events to Kafka`);

        // Convert outbox messages to Kafka messages
        const kafkaMessages = batch.map((msg) => ({
          key: msg.aggregateId, // Use aggregateId as partition key for ordering
          value: JSON.stringify({
            id: msg.id,
            aggregateId: msg.aggregateId,
            eventType: msg.eventType,
            eventVersion: msg.eventVersion,
            payload: msg.payload,
            metadata: msg.metadata,
            createdAt: msg.createdAt,
          }),
          headers: {
            'event-type': msg.eventType,
            'aggregate-id': msg.aggregateId,
            'correlation-id': msg.metadata?.correlationId || '',
            'causation-id': msg.metadata?.causationId || '',
          },
        }));

        // Publish to Kafka
        try {
          await this.kafkaProducer.publish({
            topic: 'wallet-events',
            messages: kafkaMessages,
            acks: -1, // Wait for all in-sync replicas
          });

          // Mark as processed in outbox
          const eventIds = batch.map((msg) => msg.id);
          await this.outboxService.markBatchProcessed(
            eventIds,
            this.consumerName,
          );

          totalPublished += batch.length;

          this.logger.debug(
            `Successfully published and marked ${batch.length} events as processed`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to publish batch to Kafka: ${error.message}`,
            error.stack,
          );
          await this.debugCapture.writeCapture({
            source: 'kafka-outbox-publisher',
            type: 'batch_publish_error',
            error: { message: error.message, stack: error.stack },
            payload: { batchSize: batch.length },
            metadata: { consumer: this.consumerName },
          });
          // Don't mark as processed - will retry in next batch
          throw error;
        }

        // Check if we should continue
        hasMore = batch.length === this.batchSize;
      }

      if (totalPublished > 0) {
        this.logger.log(`Published ${totalPublished} events to Kafka`);
      }
    } catch (error) {
      this.logger.error(
        `Error in publishOutboxEvents: ${error.message}`,
        error.stack,
      );
      await this.debugCapture.writeCapture({
        source: 'kafka-outbox-publisher',
        type: 'publisher_loop_error',
        error: { message: error.message, stack: error.stack },
        metadata: { consumer: this.consumerName },
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get publishing statistics
   */
  async getStats(): Promise<{
    unprocessedCount: number;
    lag: number;
    isRunning: boolean;
  }> {
    const unprocessedCount = await this.outboxService.getUnprocessedCount(
      this.consumerName,
    );
    const lag = await this.outboxService.getOutboxLag();

    return {
      unprocessedCount,
      lag,
      isRunning: this.isRunning,
    };
  }
}
