import { Injectable, Logger } from '@nestjs/common';
import { StoredWalletEvent } from '../../domain/events';
import {
  AuditTrailEntry,
  WalletReadModel,
  WalletReadRepository,
} from '../read-model/wallet-read.repository';

@Injectable()
export class WalletProjectionService {
  private readonly logger = new Logger(WalletProjectionService.name);

  constructor(private readonly repository: WalletReadRepository) {}

  async project(events: StoredWalletEvent[]): Promise<void> {
    for (const event of events) {
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
          this.logger.warn('Unhandled event type received in projection');
      }
    }
  }

  private async onWalletCreated(
    event: Extract<StoredWalletEvent, { type: 'WalletCreated' }>,
  ): Promise<void> {
    const timestamp = event.metadata.occurredAt;
    const auditTrail: AuditTrailEntry[] = [
      {
        type: event.type,
        description: 'Wallet created',
        occurredAt: timestamp,
      },
    ];

    const model: WalletReadModel = {
      id: event.aggregateId,
      ownerId: event.data.ownerId,
      balance: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: event.metadata.version,
      auditTrail,
    };

    await this.repository.save(model);
  }

  private async onWalletCredited(
    event: Extract<StoredWalletEvent, { type: 'WalletCredited' }>,
  ): Promise<void> {
    await this.applyBalanceChange(
      event.aggregateId,
      event.metadata.version,
      event.data.amount,
      {
        type: event.type,
        amount: event.data.amount,
        description: event.data.description ?? 'Credit',
        occurredAt: event.metadata.occurredAt,
      },
    );
  }

  private async onWalletDebited(
    event: Extract<StoredWalletEvent, { type: 'WalletDebited' }>,
  ): Promise<void> {
    await this.applyBalanceChange(
      event.aggregateId,
      event.metadata.version,
      -event.data.amount,
      {
        type: event.type,
        amount: event.data.amount,
        description: event.data.description ?? 'Debit',
        occurredAt: event.metadata.occurredAt,
      },
    );
  }

  private async applyBalanceChange(
    walletId: string,
    version: number,
    delta: number,
    auditEntry: AuditTrailEntry,
  ): Promise<void> {
    const document = await this.repository.findById(walletId);

    if (!document) {
      this.logger.warn(
        `Discarding projection update for missing wallet ${walletId}`,
      );
      return;
    }

    const updated: WalletReadModel = {
      ...document,
      balance: document.balance + delta,
      updatedAt: auditEntry.occurredAt,
      version,
      auditTrail: [...document.auditTrail, auditEntry],
    };

    await this.repository.save(updated);
  }
}
