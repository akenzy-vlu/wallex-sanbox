import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { EventStoreDbService } from '../../../infrastructure/event-store/event-store.service';
import { WalletProjectionService } from '../../../infrastructure/projections/wallet-projection.service';
import { WalletAggregate } from '../../../domain/wallet.aggregate';
import { WalletNotFoundError } from '../../../domain/errors';
import { DebitWalletCommand } from '../debit-wallet.command';
import { DistributedLockService } from '../../../infrastructure/lock/distributed-lock.service';
import { WalletSnapshotService } from '../../../infrastructure/snapshots/wallet-snapshot.service';

@CommandHandler(DebitWalletCommand)
export class DebitWalletHandler
  implements
    ICommandHandler<DebitWalletCommand, ReturnType<WalletAggregate['snapshot']>>
{
  constructor(
    private readonly eventStore: EventStoreDbService,
    private readonly projection: WalletProjectionService,
    private readonly lockService: DistributedLockService,
    private readonly snapshotService: WalletSnapshotService,
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
          throw new WalletNotFoundError(command.walletId);
        }

        const { aggregate, eventCount } = result;
        aggregate.debit(command.amount, command.description);

        const committedEvents = await this.eventStore.appendToStream(
          command.walletId,
          aggregate.getPendingEvents(),
          aggregate.getPersistedVersion(),
        );

        await this.projection.project(committedEvents);
        aggregate.markEventsCommitted();

        // Create snapshot if needed
        await this.snapshotService.createSnapshotIfNeeded(
          aggregate,
          eventCount + committedEvents.length,
        );

        return aggregate.snapshot();
      },
    );
  }
}
