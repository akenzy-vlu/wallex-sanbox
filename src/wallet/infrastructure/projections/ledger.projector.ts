import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseProjectorWorker, ProjectorConfig } from './base-projector.worker';
import { OutboxMessage, OutboxService } from '../outbox/outbox.service';
import { ProjectorCheckpoint } from './projector-checkpoint.entity';
import {
  LedgerEntryEntity,
  TransactionType,
} from '../../../ledger/domain/entities/ledger-entry.entity';

@Injectable()
export class LedgerProjector extends BaseProjectorWorker {
  constructor(
    outboxService: OutboxService,
    @InjectRepository(ProjectorCheckpoint)
    checkpointRepo: Repository<ProjectorCheckpoint>,
    @InjectRepository(LedgerEntryEntity)
    private readonly ledgerRepo: Repository<LedgerEntryEntity>,
  ) {
    const config: ProjectorConfig = {
      name: 'ledger-projector',
      batchSize: 200,
      pollIntervalMs: 1000,
      errorBackoffMs: 5000,
      maxRetries: 3,
    };
    super(config, outboxService, checkpointRepo);
  }

  protected async apply(message: OutboxMessage): Promise<void> {
    const { eventType, payload, aggregateId, metadata } = message;

    const toInt = (v: any): number => Math.round(Number(v || 0));

    this.logger.debug(
      `Applying event: ${eventType} for ${aggregateId}, payload: ${JSON.stringify(payload)}`,
    );

    switch (eventType) {
      case 'WalletCreated':
        await this.handleWalletCreated(aggregateId, payload, metadata);
        break;

      case 'WalletCredited':
        await this.handleWalletCredited(aggregateId, payload, metadata);
        break;

      case 'WalletDebited':
        await this.handleWalletDebited(aggregateId, payload, metadata);
        break;

      default:
        this.logger.warn(`Unknown event type: ${eventType}`);
    }
  }

  private async handleWalletCreated(
    walletId: string,
    payload: any,
    metadata: any,
  ): Promise<void> {
    this.logger.debug(
      `handleWalletCreated: walletId=${walletId}, payload.data=${JSON.stringify(payload.data)}`,
    );

    const { initialBalance } = payload.data || {};
    const initAmt = Math.round(Number(initialBalance || 0));

    // Only create ledger entry if there's an initial balance
    // Wallets with 0 initial balance don't need a ledger entry
    if (!initAmt || initAmt === 0) {
      this.logger.debug(
        `Skipping ledger entry for WalletCreated ${walletId} with zero balance (initialBalance=${initAmt})`,
      );
      return;
    }

    const entry = new LedgerEntryEntity();
    entry.walletId = walletId;
    entry.transactionType = TransactionType.CREDIT;
    entry.amount = initAmt;
    entry.balanceBefore = 0;
    entry.balanceAfter = initAmt;
    entry.description = 'Initial balance';
    entry.referenceId = metadata.eventId || `${walletId}-created`;
    entry.metadata = {
      timestamp: metadata.timestamp || new Date().toISOString(),
    };

    try {
      await this.ledgerRepo.insert(entry);
      this.logger.debug(
        `Ledger entry created: WalletCreated ${walletId} +${initAmt}`,
      );
    } catch (error) {
      // Handle duplicate key errors (idempotency)
      if (error.code === '23505') {
        this.logger.debug(
          `Ledger entry already exists for WalletCreated ${walletId}`,
        );
        return;
      }
      throw error;
    }
  }

  private async handleWalletCredited(
    walletId: string,
    payload: any,
    metadata: any,
  ): Promise<void> {
    const { amount, description } = payload.data;
    const amt = Math.round(Number(amount || 0));

    // Get current balance from latest ledger entry
    const latestEntry = await this.ledgerRepo.findOne({
      where: { walletId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    const balanceBefore = Math.round(
      Number(latestEntry ? latestEntry.balanceAfter : 0),
    );
    const balanceAfter = balanceBefore + amt;

    const entry = new LedgerEntryEntity();
    entry.walletId = walletId;
    entry.transactionType = TransactionType.CREDIT;
    entry.amount = amt;
    entry.balanceBefore = balanceBefore;
    entry.balanceAfter = balanceAfter;
    entry.description = description || 'Credit';
    entry.referenceId =
      metadata.eventId || `${walletId}-credited-${Date.now()}`;
    entry.metadata = {
      timestamp: metadata.timestamp || new Date().toISOString(),
    };

    try {
      await this.ledgerRepo.insert(entry);
      this.logger.debug(
        `Ledger entry created: WalletCredited ${walletId} +${amt}`,
      );
    } catch (error) {
      // Handle duplicate key errors (idempotency)
      if (error.code === '23505') {
        this.logger.debug(
          `Ledger entry already exists for WalletCredited ${walletId}`,
        );
        return;
      }
      throw error;
    }
  }

  private async handleWalletDebited(
    walletId: string,
    payload: any,
    metadata: any,
  ): Promise<void> {
    const { amount, description } = payload.data;
    const amt = Math.round(Number(amount || 0));

    // Get current balance from latest ledger entry
    const latestEntry = await this.ledgerRepo.findOne({
      where: { walletId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    const balanceBefore = Math.round(
      Number(latestEntry ? latestEntry.balanceAfter : 0),
    );
    const balanceAfter = balanceBefore - amt;

    const entry = new LedgerEntryEntity();
    entry.walletId = walletId;
    entry.transactionType = TransactionType.DEBIT;
    entry.amount = amt;
    entry.balanceBefore = balanceBefore;
    entry.balanceAfter = balanceAfter;
    entry.description = description || 'Debit';
    entry.referenceId = metadata.eventId || `${walletId}-debited-${Date.now()}`;
    entry.metadata = {
      timestamp: metadata.timestamp || new Date().toISOString(),
    };

    try {
      await this.ledgerRepo.insert(entry);
      this.logger.debug(
        `Ledger entry created: WalletDebited ${walletId} -${amount}`,
      );
    } catch (error) {
      // Handle duplicate key errors (idempotency)
      if (error.code === '23505') {
        this.logger.debug(
          `Ledger entry already exists for WalletDebited ${walletId}`,
        );
        return;
      }
      throw error;
    }
  }
}
