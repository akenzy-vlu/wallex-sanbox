import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { EventStoreDbService } from '../../../infrastructure/event-store/event-store.service';
import { WalletAggregate } from '../../../domain/wallet.aggregate';
import { WalletNotFoundError } from '../../../domain/errors';
import { TransferWalletCommand } from '../transfer-wallet.command';
import { DistributedLockService } from '../../../infrastructure/lock/distributed-lock.service';
import { WalletSnapshotService } from '../../../infrastructure/snapshots/wallet-snapshot.service';
import { WalletRepository } from '../../../infrastructure/persistence/wallet.repository';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service';

export interface TransferResult {
  fromWallet: ReturnType<WalletAggregate['snapshot']>;
  toWallet: ReturnType<WalletAggregate['snapshot']>;
}

@CommandHandler(TransferWalletCommand)
export class TransferWalletHandler
  implements ICommandHandler<TransferWalletCommand, TransferResult>
{
  private readonly logger = new Logger(TransferWalletHandler.name);

  constructor(
    private readonly eventStore: EventStoreDbService,
    private readonly lockService: DistributedLockService,
    private readonly snapshotService: WalletSnapshotService,
    private readonly walletRepository: WalletRepository,
    private readonly outboxService: OutboxService,
  ) {}

  async execute(command: TransferWalletCommand): Promise<TransferResult> {
    const { fromWalletId, toWalletId, amount, description } = command;

    // Validate that source and destination are different
    if (fromWalletId === toWalletId) {
      throw new Error('Cannot transfer to the same wallet');
    }

    // Lock both wallets in consistent order to prevent deadlocks
    // Always lock wallets in alphabetical order
    const [firstWalletId, secondWalletId] = [fromWalletId, toWalletId].sort();

    return this.lockService.withLock(
      `lock:wallet:${firstWalletId}`,
      5000, // 5 seconds TTL
      async () => {
        return this.lockService.withLock(
          `lock:wallet:${secondWalletId}`,
          5000, // 5 seconds TTL
          async () => {
            // Load source wallet with snapshot optimization
            const fromResult =
              await this.snapshotService.loadAggregate(fromWalletId);
            if (!fromResult) {
              throw new WalletNotFoundError(fromWalletId);
            }

            // Load destination wallet with snapshot optimization
            const toResult =
              await this.snapshotService.loadAggregate(toWalletId);
            if (!toResult) {
              throw new WalletNotFoundError(toWalletId);
            }

            const { aggregate: fromAggregate, eventCount: fromEventCount } =
              fromResult;
            const { aggregate: toAggregate, eventCount: toEventCount } =
              toResult;

            // Build transfer description
            const fromDescription =
              description || `Transfer to wallet ${toWalletId}`;
            const toDescription =
              description || `Transfer from wallet ${fromWalletId}`;

            // Debit from source wallet
            fromAggregate.debit(amount, fromDescription);

            // Credit to destination wallet
            toAggregate.credit(amount, toDescription);

            // Commit source wallet events
            const fromCommittedEvents = await this.eventStore.appendToStream(
              fromWalletId,
              fromAggregate.getPendingEvents(),
              fromAggregate.getPersistedVersion(),
            );

            // Commit destination wallet events
            const toCommittedEvents = await this.eventStore.appendToStream(
              toWalletId,
              toAggregate.getPendingEvents(),
              toAggregate.getPersistedVersion(),
            );

            try {
              // Execute transfer in write-side persistence (non-critical)
              await this.walletRepository.transfer(
                fromWalletId,
                toWalletId,
                amount,
              );
              this.logger.log(
                `Transfer completed in write-side persistence: ${amount} from ${fromWalletId} to ${toWalletId}`,
              );
            } catch (error) {
              this.logger.error(
                `Failed to persist transfer to write-side (non-critical): ${error.message}`,
              );
            }

            try {
              // Enqueue events for both wallets to outbox for async projection
              await Promise.all([
                this.outboxService.enqueue(fromCommittedEvents, {
                  aggregateId: fromWalletId,
                }),
                this.outboxService.enqueue(toCommittedEvents, {
                  aggregateId: toWalletId,
                }),
              ]);
              this.logger.log(
                `Events enqueued to outbox for transfer from ${fromWalletId} to ${toWalletId}`,
              );
            } catch (error) {
              this.logger.error(
                `Failed to enqueue transfer events to outbox: ${error.message}`,
              );
            }

            // Mark events as committed
            fromAggregate.markEventsCommitted();
            toAggregate.markEventsCommitted();

            // Create snapshots if needed
            await Promise.all([
              this.snapshotService.createSnapshotIfNeeded(
                fromAggregate,
                fromEventCount + fromCommittedEvents.length,
              ),
              this.snapshotService.createSnapshotIfNeeded(
                toAggregate,
                toEventCount + toCommittedEvents.length,
              ),
            ]);

            this.logger.log(
              `Transfer completed successfully: ${amount} from ${fromWalletId} to ${toWalletId}`,
            );

            return {
              fromWallet: fromAggregate.snapshot(),
              toWallet: toAggregate.snapshot(),
            };
          },
        );
      },
    );
  }
}
