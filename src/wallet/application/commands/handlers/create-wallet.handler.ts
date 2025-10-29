import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { WalletAggregate } from '../../../domain/wallet.aggregate';
import { WalletAlreadyExistsError } from '../../../domain/errors';
import { EventStoreDbService } from '../../../infrastructure/event-store/event-store.service';
import { WalletProjectionService } from '../../../infrastructure/projections/wallet-projection.service';
import { CreateWalletCommand } from '../create-wallet.command';
import { DistributedLockService } from '../../../infrastructure/lock/distributed-lock.service';
import { WalletRepository } from '../../../infrastructure/persistence/wallet.repository';
import { Logger } from '@nestjs/common';
import { LedgerProjectionService } from '../../../../ledger/application/ledger-projection.service';

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
    private readonly projection: WalletProjectionService,
    private readonly lockService: DistributedLockService,
    private readonly walletRepository: WalletRepository,
    private readonly ledgerProjection: LedgerProjectionService,
  ) {}

  async execute(
    command: CreateWalletCommand,
  ): Promise<ReturnType<WalletAggregate['snapshot']>> {
    // Acquire lock for the wallet
    return this.lockService.withLock(
      `lock:wallet:${command.walletId}`,
      5000, // 5 seconds TTL
      async () => {
        // Check if wallet already exists in event store
        const history = await this.eventStore.readStream(command.walletId);
        if (history.length > 0) {
          throw new WalletAlreadyExistsError(command.walletId);
        }

        // Check if wallet already exists in persistence layer
        const existingWallet = await this.walletRepository.findById(
          command.walletId,
        );
        if (existingWallet) {
          throw new WalletAlreadyExistsError(command.walletId);
        }

        // Create aggregate and generate events
        const aggregate = WalletAggregate.create(
          command.walletId,
          command.ownerId,
          command.initialBalance,
        );
        const pendingEvents = aggregate.getPendingEvents();

        // Append events to event store
        const committedEvents = await this.eventStore.appendToStream(
          command.walletId,
          pendingEvents,
          aggregate.getPersistedVersion(),
        );

        try {
          // Insert wallet into persistence layer (PostgreSQL)
          await this.walletRepository.create(
            command.walletId,
            command.ownerId,
            command.initialBalance || 0,
          );
          this.logger.log(
            `Wallet ${command.walletId} created in persistence layer`,
          );

          // Project events to read model
          await this.projection.project(committedEvents);

          // Project events to ledger
          await this.ledgerProjection.project(committedEvents);

          aggregate.markEventsCommitted();

          return aggregate.snapshot();
        } catch (error) {
          // If persistence or projection fails, log the error
          // Note: The events are already in the event store, which is the source of truth
          this.logger.error(
            `Failed to persist wallet ${command.walletId} to database or read model: ${error.message}`,
            error.stack,
          );
          // Consider implementing compensation logic or retry mechanism here
          throw error;
        }
      },
    );
  }
}
