import { Injectable, Logger } from '@nestjs/common';
import { StoredWalletEvent } from '../../../wallet/domain/events';
import { LedgerService } from '../ledger.service';
import { TransactionType } from '../../domain/entities/ledger-entry.entity';

@Injectable()
export class WalletCreatedEventHandler {
  private readonly logger = new Logger(WalletCreatedEventHandler.name);

  constructor(private readonly ledgerService: LedgerService) {}

  async handle(
    event: Extract<StoredWalletEvent, { type: 'WalletCreated' }>,
  ): Promise<void> {
    // Only record ledger entry if there's an initial balance
    const initialBalance = event.data.initialBalance ?? 0;

    if (initialBalance > 0) {
      try {
        await this.ledgerService.recordEntry({
          walletId: event.aggregateId,
          transactionType: TransactionType.CREDIT,
          amount: initialBalance,
          balanceBefore: 0,
          balanceAfter: initialBalance,
          description: 'Initial balance',
          metadata: {
            ownerId: event.data.ownerId,
            eventType: 'WalletCreated',
            eventVersion: event.metadata.version,
            occurredAt: event.metadata.occurredAt,
          },
        });

        this.logger.log(
          `Ledger entry created for wallet ${event.aggregateId} initial balance`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to create ledger entry for WalletCreated event: ${error.message}`,
          error.stack,
        );
        // Don't throw - ledger is supplementary
      }
    }
  }
}
