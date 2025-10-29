import { Injectable, Logger } from '@nestjs/common';
import { StoredWalletEvent } from '../../../wallet/domain/events';
import { LedgerService } from '../ledger.service';
import { TransactionType } from '../../domain/entities/ledger-entry.entity';

@Injectable()
export class WalletDebitedEventHandler {
  private readonly logger = new Logger(WalletDebitedEventHandler.name);

  constructor(private readonly ledgerService: LedgerService) {}

  async handle(
    event: Extract<StoredWalletEvent, { type: 'WalletDebited' }>,
    balanceBefore: number,
    balanceAfter: number,
    relatedWalletId?: string,
  ): Promise<void> {
    try {
      // Determine if this is a transfer or regular debit
      const isTransfer = !!relatedWalletId;

      await this.ledgerService.recordEntry({
        walletId: event.aggregateId,
        transactionType: isTransfer
          ? TransactionType.TRANSFER_OUT
          : TransactionType.DEBIT,
        amount: event.data.amount,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        description:
          event.data.description ||
          (isTransfer ? 'Transfer out' : 'Debit transaction'),
        relatedWalletId: relatedWalletId,
        metadata: {
          eventType: 'WalletDebited',
          eventVersion: event.metadata.version,
          occurredAt: event.metadata.occurredAt,
          transferType: isTransfer ? 'outgoing' : undefined,
        },
      });

      this.logger.log(
        `Ledger entry created for wallet ${event.aggregateId} debit`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create ledger entry for WalletDebited event: ${error.message}`,
        error.stack,
      );
      // Don't throw - ledger is supplementary
    }
  }
}
