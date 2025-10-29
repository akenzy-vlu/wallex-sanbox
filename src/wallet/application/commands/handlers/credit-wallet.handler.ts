import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { EventStoreDbService } from '../../../infrastructure/event-store/event-store.service';
import { WalletProjectionService } from '../../../infrastructure/projections/wallet-projection.service';
import { WalletAggregate } from '../../../domain/wallet.aggregate';
import { WalletNotFoundError } from '../../../domain/errors';
import { CreditWalletCommand } from '../credit-wallet.command';
import { DistributedLockService } from '../../../infrastructure/lock/distributed-lock.service';
import { WalletSnapshotService } from '../../../infrastructure/snapshots/wallet-snapshot.service';
import { WalletRepository } from '../../../infrastructure/persistence/wallet.repository';
import { LedgerProjectionService } from '../../../../ledger/application/ledger-projection.service';

@CommandHandler(CreditWalletCommand)
export class CreditWalletHandler
  implements
    ICommandHandler<
      CreditWalletCommand,
      ReturnType<WalletAggregate['snapshot']>
    >
{
  private readonly logger = new Logger(CreditWalletHandler.name);

  constructor(
    private readonly eventStore: EventStoreDbService,
    private readonly projection: WalletProjectionService,
    private readonly lockService: DistributedLockService,
    private readonly snapshotService: WalletSnapshotService,
    private readonly walletRepository: WalletRepository,
    private readonly ledgerProjection: LedgerProjectionService,
  ) {}

  async execute(
    command: CreditWalletCommand,
  ): Promise<ReturnType<WalletAggregate['snapshot']>> {
    // Acquire lock for the wallet
    return this.lockService.withLock(
      `lock:wallet:${command.walletId}`,
      5000, // 5 seconds TTL
      async () => {
        this.logger.debug(
          `Processing credit command: ${JSON.stringify(command)}`,
        );

        // Load aggregate with snapshot optimization
        const result = await this.snapshotService.loadAggregate(
          command.walletId,
        );
        if (!result) {
          this.logger.warn(`Wallet not found: ${command.walletId}`);
          throw new WalletNotFoundError(command.walletId);
        }

        const { aggregate, eventCount } = result;

        aggregate.credit(command.amount, command.description);

        // Append events to event store
        const committedEvents = await this.eventStore.appendToStream(
          command.walletId,
          aggregate.getPendingEvents(),
          aggregate.getPersistedVersion(),
        );

        try {
          // Update persistence layer (PostgreSQL)
          await this.walletRepository.credit(command.walletId, command.amount);
          this.logger.log(
            `Wallet ${command.walletId} credited ${command.amount} in persistence layer`,
          );

          // Project events to read model
          await this.projection.project(committedEvents);

          // Project events to ledger
          await this.ledgerProjection.project(committedEvents);

          aggregate.markEventsCommitted();

          // Create snapshot if needed
          await this.snapshotService.createSnapshotIfNeeded(
            aggregate,
            eventCount + committedEvents.length,
          );

          return aggregate.snapshot();
        } catch (error) {
          this.logger.error(
            `Failed to persist credit for wallet ${command.walletId}: ${error.message}`,
            error.stack,
          );
          throw error;
        }
      },
    );
  }
}
