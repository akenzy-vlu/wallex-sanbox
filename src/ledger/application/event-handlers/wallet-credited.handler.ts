import { Injectable, Logger } from '@nestjs/common';
import { StoredWalletEvent } from '../../../wallet/domain/events';
import { LedgerService } from '../ledger.service';
import { TransactionType } from '../../domain/entities/ledger-entry.entity';

@Injectable()
export class WalletCreditedEventHandler {
  private readonly logger = new Logger(WalletCreditedEventHandler.name);

  constructor(private readonly ledgerService: LedgerService) {}

  async handle(
    event: Extract<StoredWalletEvent, { type: 'WalletCredited' }>,
    balanceBefore: number,
    balanceAfter: number,
  ): Promise<void> {
    try {
      await this.ledgerService.recordEntry({
        walletId: event.aggregateId,
        transactionType: TransactionType.CREDIT,
        amount: event.data.amount,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        description: event.data.description || 'Credit transaction',
        metadata: {
          eventType: 'WalletCredited',
          eventVersion: event.metadata.version,
          occurredAt: event.metadata.occurredAt,
        },
      });

      this.logger.log(
        `Ledger entry created for wallet ${event.aggregateId} credit`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create ledger entry for WalletCredited event: ${error.message}`,
        error.stack,
      );
      // Don't throw - ledger is supplementary
    }
  }
}
