import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { WalletAggregate } from '../../../domain/wallet.aggregate';
import { WalletAlreadyExistsError } from '../../../domain/errors';
import { EventStoreDbService } from '../../../infrastructure/event-store/event-store.service';
import { CreateWalletCommand } from '../create-wallet.command';
import { DistributedLockService } from '../../../infrastructure/lock/distributed-lock.service';
import { WalletRepository } from '../../../infrastructure/persistence/wallet.repository';
import { Logger } from '@nestjs/common';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service';
import { IdempotencyService } from '../../../infrastructure/idempotency/idempotency.service';

@CommandHandler(CreateWalletCommand)
export class CreateWalletHandler
  implements
    ICommandHandler<
      CreateWalletCommand,
      ReturnType<WalletAggregate['snapshot']>
    >
{
  private readonly logger = new Logger(CreateWalletHandler.name);

  constructor(
    private readonly eventStore: EventStoreDbService,
    private readonly lockService: DistributedLockService,
    private readonly walletRepository: WalletRepository,
    private readonly outboxService: OutboxService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async execute(
    command: CreateWalletCommand,
  ): Promise<ReturnType<WalletAggregate['snapshot']>> {
    const startTime = Date.now();

    // Check idempotency first (before acquiring lock)
    if (command.idempotencyKey) {
      const cachedResponse = await this.idempotencyService.tryGet(
        command.idempotencyKey,
        {
          walletId: command.walletId,
          ownerId: command.ownerId,
          initialBalance: command.initialBalance,
        },
      );

      if (cachedResponse) {
        this.logger.debug(
          `Returning cached response for idempotency key: ${command.idempotencyKey}`,
        );
        this.emitMetrics({
          operation: 'create_wallet',
          status: 'idempotent',
          durationMs: Date.now() - startTime,
        });
        return cachedResponse;
      }
    }

    // Acquire lock for the wallet
    return this.lockService.withLock(
      `lock:wallet:${command.walletId}`,
      5000, // 5 seconds TTL
      async () => {
        try {
          // Check if wallet already exists in event store
          const history = await this.eventStore.readStream(command.walletId);
          if (history.length > 0) {
            throw new WalletAlreadyExistsError(command.walletId);
          }

          // Check if wallet already exists in persistence layer (defensive check)
          const existingWallet = await this.walletRepository.findById(
            command.walletId,
          );
          if (existingWallet) {
            throw new WalletAlreadyExistsError(command.walletId);
          }

          // Store pending idempotency key
          if (command.idempotencyKey) {
            await this.idempotencyService.storePending(command.idempotencyKey, {
              walletId: command.walletId,
              ownerId: command.ownerId,
              initialBalance: command.initialBalance,
            });
          }

          // Create aggregate and generate events
          const aggregate = WalletAggregate.create(
            command.walletId,
            command.ownerId,
            command.initialBalance,
          );
          const pendingEvents = aggregate.getPendingEvents();

          // Append events to event store (source of truth)
          const committedEvents = await this.eventStore.appendToStream(
            command.walletId,
            pendingEvents,
            aggregate.getPersistedVersion(),
          );

          this.logger.log(
            `Events appended to event store for wallet ${command.walletId}`,
          );

          // Persist write-side state (for admin/reporting queries)
          try {
            await this.walletRepository.create(
              command.walletId,
              command.ownerId,
              command.initialBalance || 0,
            );
            this.logger.log(
              `Wallet ${command.walletId} created in write-side persistence`,
            );
          } catch (error) {
            // Non-critical failure - event store is source of truth
            this.logger.error(
              `Failed to persist wallet ${command.walletId} to database (non-critical): ${error.message}`,
            );
            // Optionally enqueue recovery task
          }

          // Enqueue events to outbox for async projection
          try {
            await this.outboxService.enqueue(committedEvents, {
              aggregateId: command.walletId,
              correlationId: command.correlationId,
              causationId: command.idempotencyKey,
            });
            this.logger.log(
              `Events enqueued to outbox for wallet ${command.walletId}`,
            );
          } catch (error) {
            // Non-critical failure - projectors can rebuild from event store
            this.logger.error(
              `Failed to enqueue events to outbox for wallet ${command.walletId}: ${error.message}`,
            );
            // Optionally enqueue recovery task
          }

          // Mark events as committed
          aggregate.markEventsCommitted();

          // Get snapshot to return
          const snapshot = aggregate.snapshot();

          // Store successful response for idempotency
          if (command.idempotencyKey) {
            await this.idempotencyService.store(
              command.idempotencyKey,
              snapshot,
            );
          }

          // Emit metrics
          this.emitMetrics({
            operation: 'create_wallet',
            status: 'success',
            durationMs: Date.now() - startTime,
          });

          this.logger.log(
            `Wallet ${command.walletId} created successfully in ${Date.now() - startTime}ms`,
          );

          return snapshot;
        } catch (error) {
          // Mark idempotency key as failed
          if (command.idempotencyKey) {
            await this.idempotencyService.markFailed(command.idempotencyKey);
          }

          // Emit error metrics
          this.emitMetrics({
            operation: 'create_wallet',
            status: 'error',
            error: error.message,
            durationMs: Date.now() - startTime,
          });

          throw error;
        }
      },
    );
  }

  private emitMetrics(metrics: {
    operation: string;
    status: string;
    durationMs: number;
    error?: string;
  }): void {
    // Default implementation: log metrics
    // Override or integrate with Prometheus, Datadog, etc.
    this.logger.debug(`Metrics: ${JSON.stringify(metrics)}`);
  }
}
