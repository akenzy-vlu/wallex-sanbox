import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { EventStoreDbService } from '../../../infrastructure/event-store/event-store.service';
import { WalletAggregate } from '../../../domain/wallet.aggregate';
import { WalletNotFoundError } from '../../../domain/errors';
import { DebitWalletCommand } from '../debit-wallet.command';
import { DistributedLockService } from '../../../infrastructure/lock/distributed-lock.service';
import { WalletSnapshotService } from '../../../infrastructure/snapshots/wallet-snapshot.service';
import { WalletRepository } from '../../../infrastructure/persistence/wallet.repository';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service';

@CommandHandler(DebitWalletCommand)
export class DebitWalletHandler
  implements
    ICommandHandler<DebitWalletCommand, ReturnType<WalletAggregate['snapshot']>>
{
  private readonly logger = new Logger(DebitWalletHandler.name);

  constructor(
    private readonly eventStore: EventStoreDbService,
    private readonly lockService: DistributedLockService,
    private readonly snapshotService: WalletSnapshotService,
    private readonly walletRepository: WalletRepository,
    private readonly outboxService: OutboxService,
  ) {}

  async execute(
    command: DebitWalletCommand,
  ): Promise<ReturnType<WalletAggregate['snapshot']>> {
    // Acquire lock for the wallet
    return this.lockService.withLock(
      `lock:wallet:${command.walletId}`,
      5000, // 5 seconds TTL
      async () => {
        // Load aggregate with snapshot optimization
        const result = await this.snapshotService.loadAggregate(
          command.walletId,
        );
        if (!result) {
          this.logger.warn(`Wallet not found: ${command.walletId}`);
          throw new WalletNotFoundError(command.walletId);
        }

        const { aggregate, eventCount } = result;

        aggregate.debit(command.amount, command.description);

        // Append events to event store
        const committedEvents = await this.eventStore.appendToStream(
          command.walletId,
          aggregate.getPendingEvents(),
          aggregate.getPersistedVersion(),
        );

        try {
          // Update write-side persistence (non-critical)
          await this.walletRepository.debit(command.walletId, command.amount);
          this.logger.log(
            `Wallet ${command.walletId} debited ${command.amount} in write-side persistence`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to persist debit to write-side (non-critical): ${error.message}`,
          );
        }

        try {
          // Enqueue events to outbox for async projection
          await this.outboxService.enqueue(committedEvents, {
            aggregateId: command.walletId,
          });
          this.logger.log(
            `Events enqueued to outbox for wallet ${command.walletId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to enqueue events to outbox for wallet ${command.walletId}: ${error.message}`,
          );
        }

        // Mark events as committed
        aggregate.markEventsCommitted();

        // Create snapshot if needed
        await this.snapshotService.createSnapshotIfNeeded(
          aggregate,
          eventCount + committedEvents.length,
        );

        this.logger.log(
          `Wallet ${command.walletId} debited ${command.amount} successfully`,
        );

        return aggregate.snapshot();
      },
    );
  }
}
