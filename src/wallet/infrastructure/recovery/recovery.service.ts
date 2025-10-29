import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThan } from 'typeorm';
import { OutboxService } from '../outbox/outbox.service';
import { OutboxEvent } from '../outbox/outbox.entity';
import { EventStoreDbService } from '../event-store/event-store.service';
import { WalletRepository } from '../persistence/wallet.repository';
import { Wallet } from '../read-model/wallet.entity';

/**
 * Recovery service for handling failed projections and data inconsistencies
 *
 * This service:
 * - Monitors stale outbox events and retries them
 * - Detects data drift between event store and projections
 * - Rebuilds projections from event store when needed
 * - Provides manual recovery endpoints for ops teams
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);
  private isRecovering = false;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly eventStore: EventStoreDbService,
    private readonly walletRepository: WalletRepository,
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    @InjectRepository(Wallet)
    private readonly walletReadRepo: Repository<Wallet>,
  ) {}

  /**
   * Periodic job to detect and retry stale outbox events
   * Runs every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryStaleEvents(): Promise<void> {
    if (this.isRecovering) {
      this.logger.debug(
        'Recovery already in progress, skipping stale event retry',
      );
      return;
    }

    try {
      this.isRecovering = true;

      // Find events older than 5 minutes that are unprocessed
      const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
      const staleEvents = await this.outboxRepo.find({
        where: {
          processedAt: IsNull(),
          createdAt: LessThan(staleThreshold),
        },
        take: 100,
        order: { createdAt: 'ASC' },
      });

      if (staleEvents.length === 0) {
        return;
      }

      this.logger.warn(
        `Found ${staleEvents.length} stale outbox events, retrying...`,
      );

      // Reset consumer to allow projectors to reclaim
      for (const event of staleEvents) {
        await this.outboxRepo.update({ id: event.id }, { consumer: null });
      }

      this.logger.log(`Reset ${staleEvents.length} stale events for retry`);
    } catch (error) {
      this.logger.error(
        `Failed to retry stale events: ${error.message}`,
        error.stack,
      );
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Rebuild read model for a specific wallet from event store
   * @param walletId Wallet ID to rebuild
   */
  async rebuildWalletReadModel(walletId: string): Promise<void> {
    this.logger.log(`Rebuilding read model for wallet ${walletId}`);

    try {
      // Load all events from event store
      const events = await this.eventStore.readStream(walletId);

      if (events.length === 0) {
        this.logger.warn(`No events found for wallet ${walletId}`);
        return;
      }

      // Rebuild state from events
      let balance = 0;
      let ownerId: string | null = null;
      let createdAt: Date | null = null;

      for (const event of events) {
        switch (event.type) {
          case 'WalletCreated':
            ownerId = event.data.ownerId;
            balance = event.data.initialBalance || 0;
            createdAt = new Date(event.metadata.occurredAt);
            break;

          case 'WalletCredited':
            balance += event.data.amount;
            break;

          case 'WalletDebited':
            balance -= event.data.amount;
            break;
        }
      }

      if (!ownerId) {
        throw new Error(
          `Invalid event stream for wallet ${walletId}: no WalletCreated event`,
        );
      }

      // Upsert read model
      await this.walletReadRepo.upsert(
        {
          id: walletId,
          ownerId,
          balance,
          createdAt: createdAt || new Date(),
          updatedAt: new Date(),
        },
        ['id'],
      );

      this.logger.log(
        `Successfully rebuilt read model for wallet ${walletId} with balance ${balance}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to rebuild read model for wallet ${walletId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Rebuild read models for all wallets from event store
   * WARNING: This is a heavy operation, use with caution
   */
  async rebuildAllReadModels(): Promise<{ rebuilt: number; failed: number }> {
    this.logger.warn('Starting full read model rebuild from event store');

    const stats = { rebuilt: 0, failed: 0 };

    try {
      // Get all wallets from write-side persistence
      const wallets = await this.walletRepository.findAll();

      this.logger.log(`Found ${wallets.length} wallets to rebuild`);

      for (const wallet of wallets) {
        try {
          await this.rebuildWalletReadModel(wallet.id);
          stats.rebuilt++;
        } catch (error) {
          this.logger.error(
            `Failed to rebuild wallet ${wallet.id}: ${error.message}`,
          );
          stats.failed++;
        }
      }

      this.logger.log(
        `Read model rebuild complete: ${stats.rebuilt} rebuilt, ${stats.failed} failed`,
      );

      return stats;
    } catch (error) {
      this.logger.error(
        `Failed to rebuild all read models: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Detect data drift between write-side and read model
   * @returns Array of wallet IDs with inconsistencies
   */
  async detectDataDrift(): Promise<string[]> {
    this.logger.log('Detecting data drift between write-side and read model');

    const inconsistentWallets: string[] = [];

    try {
      const wallets = await this.walletRepository.findAll();

      for (const writeWallet of wallets) {
        const readWallet = await this.walletReadRepo.findOne({
          where: { id: writeWallet.id },
        });

        if (!readWallet) {
          this.logger.warn(`Wallet ${writeWallet.id} missing from read model`);
          inconsistentWallets.push(writeWallet.id);
          continue;
        }

        // Check balance consistency
        if (Math.abs(writeWallet.balance - readWallet.balance) > 0.01) {
          this.logger.warn(
            `Balance drift detected for wallet ${writeWallet.id}: ` +
              `write=${writeWallet.balance}, read=${readWallet.balance}`,
          );
          inconsistentWallets.push(writeWallet.id);
        }
      }

      if (inconsistentWallets.length > 0) {
        this.logger.warn(
          `Detected ${inconsistentWallets.length} wallets with data drift`,
        );
      } else {
        this.logger.log('No data drift detected');
      }

      return inconsistentWallets;
    } catch (error) {
      this.logger.error(
        `Failed to detect data drift: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get recovery statistics
   */
  async getStats(): Promise<{
    staleEvents: number;
    oldestStaleEventAge: number | null;
    unprocessedEvents: number;
  }> {
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);

    const [staleEvents, unprocessedEvents, oldestStale] = await Promise.all([
      this.outboxRepo.count({
        where: {
          processedAt: IsNull(),
          createdAt: LessThan(staleThreshold),
        },
      }),
      this.outboxService.getUnprocessedCount(),
      this.outboxRepo.findOne({
        where: { processedAt: IsNull() },
        order: { createdAt: 'ASC' },
      }),
    ]);

    const oldestStaleEventAge = oldestStale
      ? Date.now() - oldestStale.createdAt.getTime()
      : null;

    return {
      staleEvents,
      oldestStaleEventAge,
      unprocessedEvents,
    };
  }

  /**
   * Force reprocess all unprocessed events
   * (resets consumer so projectors can reclaim them)
   */
  async forceReprocessUnprocessed(): Promise<number> {
    const result = await this.outboxRepo.update(
      { processedAt: IsNull() },
      { consumer: null },
    );

    const count = result.affected || 0;
    this.logger.log(`Reset ${count} unprocessed events for reprocessing`);

    return count;
  }
}
