import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { WalletAggregate } from '../../../domain/wallet.aggregate';
import { WalletAlreadyExistsError } from '../../../domain/errors';
import { EventStoreDbService } from '../../../infrastructure/event-store/event-store.service';
import { WalletProjectionService } from '../../../infrastructure/projections/wallet-projection.service';
import { CreateWalletCommand } from '../create-wallet.command';
import { DistributedLockService } from '../../../infrastructure/lock/distributed-lock.service';

@CommandHandler(CreateWalletCommand)
export class CreateWalletHandler
  implements
    ICommandHandler<
      CreateWalletCommand,
      ReturnType<WalletAggregate['snapshot']>
    >
{
  constructor(
    private readonly eventStore: EventStoreDbService,
    private readonly projection: WalletProjectionService,
    private readonly lockService: DistributedLockService,
  ) {}

  async execute(
    command: CreateWalletCommand,
  ): Promise<ReturnType<WalletAggregate['snapshot']>> {
    // Acquire lock for the wallet
    return this.lockService.withLock(
      `lock:wallet:${command.walletId}`,
      5000, // 5 seconds TTL
      async () => {
        const history = await this.eventStore.readStream(command.walletId);
        if (history.length > 0) {
          throw new WalletAlreadyExistsError(command.walletId);
        }

        const aggregate = WalletAggregate.create(
          command.walletId,
          command.ownerId,
          command.initialBalance,
        );
        const pendingEvents = aggregate.getPendingEvents();

        const committedEvents = await this.eventStore.appendToStream(
          command.walletId,
          pendingEvents,
          aggregate.getPersistedVersion(),
        );

        await this.projection.project(committedEvents);
        aggregate.markEventsCommitted();

        return aggregate.snapshot();
      },
    );
  }
}
