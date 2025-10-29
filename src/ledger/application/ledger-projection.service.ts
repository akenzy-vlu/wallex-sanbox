import { Injectable, Logger } from '@nestjs/common';
import { StoredWalletEvent } from '../../wallet/domain/events';
import { WalletCreatedEventHandler } from './event-handlers/wallet-created.handler';
import { WalletCreditedEventHandler } from './event-handlers/wallet-credited.handler';
import { WalletDebitedEventHandler } from './event-handlers/wallet-debited.handler';

/**
 * LedgerProjectionService
 *
 * Projects wallet events to ledger entries.
 * This service listens to wallet events from the event store
 * and creates corresponding ledger entries.
 */
@Injectable()
export class LedgerProjectionService {
  private readonly logger = new Logger(LedgerProjectionService.name);

  // Track balance state per wallet to calculate before/after
  private balanceCache = new Map<string, number>();

  constructor(
    private readonly walletCreatedHandler: WalletCreatedEventHandler,
    private readonly walletCreditedHandler: WalletCreditedEventHandler,
    private readonly walletDebitedHandler: WalletDebitedEventHandler,
  ) {}

  async project(events: StoredWalletEvent[]): Promise<void> {
    for (const event of events) {
      try {
        switch (event.type) {
          case 'WalletCreated':
            await this.onWalletCreated(event);
            break;
          case 'WalletCredited':
            await this.onWalletCredited(event);
            break;
          case 'WalletDebited':
            await this.onWalletDebited(event);
            break;
          default:
            this.logger.warn(
              'Unhandled event type received in ledger projection',
            );
        }
      } catch (error) {
        this.logger.error(
          `Failed to project event to ledger: ${error.message}`,
          error.stack,
        );
        // Continue processing other events
      }
    }
  }

  private async onWalletCreated(
    event: Extract<StoredWalletEvent, { type: 'WalletCreated' }>,
  ): Promise<void> {
    const initialBalance = event.data.initialBalance ?? 0;
    this.balanceCache.set(event.aggregateId, initialBalance);
    await this.walletCreatedHandler.handle(event);
  }

  private async onWalletCredited(
    event: Extract<StoredWalletEvent, { type: 'WalletCredited' }>,
  ): Promise<void> {
    const balanceBefore = this.balanceCache.get(event.aggregateId) ?? 0;
    const balanceAfter = balanceBefore + event.data.amount;
    this.balanceCache.set(event.aggregateId, balanceAfter);

    await this.walletCreditedHandler.handle(event, balanceBefore, balanceAfter);
  }

  private async onWalletDebited(
    event: Extract<StoredWalletEvent, { type: 'WalletDebited' }>,
  ): Promise<void> {
    const balanceBefore = this.balanceCache.get(event.aggregateId) ?? 0;
    const balanceAfter = balanceBefore - event.data.amount;
    this.balanceCache.set(event.aggregateId, balanceAfter);

    // Check if this is a transfer by looking at the description
    const description = event.data.description || '';
    let relatedWalletId: string | undefined;

    // Extract related wallet ID from description if it's a transfer
    const transferMatch = description.match(/Transfer (?:to|from) wallet (.+)/);
    if (transferMatch) {
      relatedWalletId = transferMatch[1];
    }

    await this.walletDebitedHandler.handle(
      event,
      balanceBefore,
      balanceAfter,
      relatedWalletId,
    );
  }

  /**
   * Clear balance cache for testing or reset
   */
  clearCache(): void {
    this.balanceCache.clear();
  }
}
