import { Logger } from '@nestjs/common';
import { OutboxService, OutboxMessage } from '../outbox/outbox.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectorCheckpoint } from './projector-checkpoint.entity';

export interface ProjectorConfig {
  name: string;
  batchSize: number;
  pollIntervalMs: number;
  errorBackoffMs: number;
  maxRetries: number;
}

export abstract class BaseProjectorWorker {
  protected readonly logger: Logger;
  protected isRunning = false;
  protected consecutiveErrors = 0;

  constructor(
    protected readonly config: ProjectorConfig,
    protected readonly outboxService: OutboxService,
    @InjectRepository(ProjectorCheckpoint)
    protected readonly checkpointRepo: Repository<ProjectorCheckpoint>,
  ) {
    this.logger = new Logger(`${config.name}Worker`);
  }

  /**
   * Start the projector worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Projector already running');
      return;
    }

    this.isRunning = true;
    this.logger.log(`Starting ${this.config.name} projector worker`);

    // Ensure checkpoint exists
    await this.ensureCheckpoint();

    // Start polling loop
    this.poll();
  }

  /**
   * Stop the projector worker
   */
  async stop(): Promise<void> {
    this.logger.log(`Stopping ${this.config.name} projector worker`);
    this.isRunning = false;
  }

  /**
   * Main polling loop
   */
  private async poll(): Promise<void> {
    while (this.isRunning) {
      try {
        const startTime = Date.now();

        // Claim batch of events
        const batch = await this.outboxService.claimBatch({
          size: this.config.batchSize,
          consumer: this.config.name,
        });

        if (batch.length === 0) {
          // No events to process, wait and try again
          await this.sleep(this.config.pollIntervalMs);
          continue;
        }

        this.logger.debug(
          `Processing batch of ${batch.length} events for ${this.config.name}`,
        );

        // Process batch
        await this.processBatch(batch);

        // Reset error counter on success
        this.consecutiveErrors = 0;

        const duration = Date.now() - startTime;
        this.logger.debug(`Processed ${batch.length} events in ${duration}ms`);

        // Emit metrics
        this.emitMetrics({
          batchSize: batch.length,
          durationMs: duration,
          success: true,
        });
      } catch (error) {
        this.consecutiveErrors++;
        this.logger.error(
          `Error processing batch (attempt ${this.consecutiveErrors}/${this.config.maxRetries}): ${error.message}`,
          error.stack,
        );

        this.emitMetrics({
          batchSize: 0,
          durationMs: 0,
          success: false,
          error: error.message,
        });

        // Backoff on consecutive errors
        if (this.consecutiveErrors >= this.config.maxRetries) {
          this.logger.error(
            `Max retries (${this.config.maxRetries}) exceeded. Backing off...`,
          );
          await this.sleep(this.config.errorBackoffMs * this.consecutiveErrors);
        } else {
          await this.sleep(this.config.errorBackoffMs);
        }
      }
    }
  }

  /**
   * Process a batch of events
   */
  private async processBatch(batch: OutboxMessage[]): Promise<void> {
    const processedIds: string[] = [];

    for (const message of batch) {
      try {
        // Check if already processed (idempotency)
        if (await this.isAlreadyProcessed(message)) {
          this.logger.debug(`Event ${message.id} already processed, skipping`);
          processedIds.push(message.id);
          continue;
        }

        // Apply projection (implemented by subclass)
        await this.apply(message);

        // Save checkpoint
        await this.saveCheckpoint(message);

        processedIds.push(message.id);

        this.logger.debug(
          `Successfully processed event ${message.id} (${message.eventType})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to process event ${message.id}: ${error.message}`,
          error.stack,
        );

        // Continue with other events in batch, but don't mark this one as processed
        // The outbox will retry it in the next batch
      }
    }

    // Mark all successfully processed events
    if (processedIds.length > 0) {
      await this.outboxService.markBatchProcessed(
        processedIds,
        this.config.name,
      );
    }
  }

  /**
   * Apply a single event (implemented by subclass)
   */
  protected abstract apply(message: OutboxMessage): Promise<void>;

  /**
   * Check if event was already processed (idempotency check)
   */
  protected async isAlreadyProcessed(message: OutboxMessage): Promise<boolean> {
    const checkpoint = await this.getCheckpoint();

    if (!checkpoint) {
      return false;
    }

    // Check if we've already processed this version for this aggregate
    if (
      checkpoint.aggregateId === message.aggregateId &&
      checkpoint.lastProcessedVersion >= message.eventVersion
    ) {
      return true;
    }

    // Check by outbox ID (cursor-based)
    if (
      checkpoint.lastProcessedId &&
      BigInt(checkpoint.lastProcessedId) >= BigInt(message.id)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Save checkpoint after processing an event
   */
  protected async saveCheckpoint(message: OutboxMessage): Promise<void> {
    await this.checkpointRepo.upsert(
      {
        projectorName: this.config.name,
        aggregateId: message.aggregateId,
        lastProcessedVersion: message.eventVersion,
        lastProcessedId: message.id,
        lastProcessedAt: new Date(),
        updatedAt: new Date(),
      },
      ['projectorName'],
    );
  }

  /**
   * Get current checkpoint
   */
  protected async getCheckpoint(): Promise<ProjectorCheckpoint | null> {
    return this.checkpointRepo.findOne({
      where: { projectorName: this.config.name },
    });
  }

  /**
   * Ensure checkpoint exists
   */
  private async ensureCheckpoint(): Promise<void> {
    const exists = await this.checkpointRepo.findOne({
      where: { projectorName: this.config.name },
    });

    if (!exists) {
      await this.checkpointRepo.insert({
        projectorName: this.config.name,
        aggregateId: null,
        lastProcessedVersion: 0,
        lastProcessedId: '0',
        lastProcessedAt: new Date(),
        updatedAt: new Date(),
        metadata: null,
      });
    }
  }

  /**
   * Emit metrics (override in subclass to integrate with monitoring)
   */
  protected emitMetrics(metrics: {
    batchSize: number;
    durationMs: number;
    success: boolean;
    error?: string;
  }): void {
    // Default implementation: log metrics
    // Override this method to integrate with Prometheus, Datadog, etc.
    this.logger.debug(`Metrics: ${JSON.stringify(metrics)}`);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
