import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BaseKafkaConsumer,
  MessageContext,
} from '../../../kafka/kafka-consumer.base';
import {
  LedgerEntryEntity,
  TransactionType,
} from '../../../ledger/domain/entities/ledger-entry.entity';
import { ProjectorCheckpoint } from './projector-checkpoint.entity';
import { DebugCaptureService } from '../../../integration/application/debug-capture.service';

interface WalletEvent {
  id: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: any;
  metadata: any;
  createdAt: string;
}

@Injectable()
export class LedgerKafkaConsumer extends BaseKafkaConsumer {
  constructor(
    configService: ConfigService,
    @InjectRepository(LedgerEntryEntity)
    private readonly ledgerRepo: Repository<LedgerEntryEntity>,
    @InjectRepository(ProjectorCheckpoint)
    private readonly checkpointRepo: Repository<ProjectorCheckpoint>,
    debugCapture: DebugCaptureService,
  ) {
    super(
      {
        groupId: 'ledger-projector',
        topics: ['wallet-events'],
        fromBeginning: false,
        autoCommit: true,
        autoCommitInterval: 5000,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
      },
      configService,
      debugCapture,
    );
  }

  /**
   * Process incoming Kafka message
   */
  protected async processMessage(
    context: MessageContext,
    value: string,
  ): Promise<void> {
    const event: WalletEvent = JSON.parse(value);

    this.logger.debug(
      `Processing event ${event.eventType} for wallet ${event.aggregateId}`,
    );

    // Check idempotency
    if (await this.isAlreadyProcessed(event)) {
      this.logger.debug(`Event ${event.id} already processed, skipping`);
      return;
    }

    // Apply projection based on event type
    await this.applyProjection(event);

    // Save checkpoint
    await this.saveCheckpoint(event);

    // Heartbeat to keep consumer alive
    await context.heartbeat();
  }

  /**
   * Apply ledger projection based on event type
   */
  private async applyProjection(event: WalletEvent): Promise<void> {
    try {
      switch (event.eventType) {
        case 'WalletCreated':
        case 'WalletCreatedEvent':
          await this.handleWalletCreated(event);
          break;

        case 'WalletCredited':
        case 'WalletCreditedEvent':
          await this.handleWalletCredited(event);
          break;

        case 'WalletDebited':
        case 'WalletDebitedEvent':
          await this.handleWalletDebited(event);
          break;

        case 'WalletTransferInitiated':
        case 'WalletTransferInitiatedEvent':
          await this.handleTransferInitiated(event);
          break;

        case 'WalletTransferCompleted':
        case 'WalletTransferCompletedEvent':
          await this.handleTransferCompleted(event);
          break;

        default:
          this.logger.warn(`Unknown event type: ${event.eventType}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to apply projection for event ${event.id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async handleWalletCreated(event: WalletEvent): Promise<void> {
    const { walletId, ownerId, initialBalance } = event.payload;

    if (initialBalance && initialBalance > 0) {
      const entry = this.ledgerRepo.create({
        walletId,
        referenceId: event.id,
        transactionType: TransactionType.CREDIT,
        amount: initialBalance,
        balanceBefore: 0,
        balanceAfter: initialBalance,
        description: 'Initial balance',
        metadata: { ownerId, eventType: event.eventType },
      });

      await this.ledgerRepo.save(entry);
      this.logger.debug(`Created initial ledger entry for wallet ${walletId}`);
    }
  }

  private async handleWalletCredited(event: WalletEvent): Promise<void> {
    const { walletId, amount, description, balance, previousBalance } =
      event.payload;

    const entry = this.ledgerRepo.create({
      walletId,
      referenceId: event.metadata?.correlationId || event.id,
      transactionType: TransactionType.CREDIT,
      amount,
      balanceBefore: previousBalance || balance - amount,
      balanceAfter: balance,
      description: description || 'Credit',
      metadata: { eventId: event.id, eventType: event.eventType },
    });

    await this.ledgerRepo.save(entry);
    this.logger.debug(
      `Created credit ledger entry for wallet ${walletId}, amount: ${amount}`,
    );
  }

  private async handleWalletDebited(event: WalletEvent): Promise<void> {
    const { walletId, amount, description, balance, previousBalance } =
      event.payload;

    const entry = this.ledgerRepo.create({
      walletId,
      referenceId: event.metadata?.correlationId || event.id,
      transactionType: TransactionType.DEBIT,
      amount,
      balanceBefore: previousBalance || balance + amount,
      balanceAfter: balance,
      description: description || 'Debit',
      metadata: { eventId: event.id, eventType: event.eventType },
    });

    await this.ledgerRepo.save(entry);
    this.logger.debug(
      `Created debit ledger entry for wallet ${walletId}, amount: ${amount}`,
    );
  }

  private async handleTransferInitiated(event: WalletEvent): Promise<void> {
    const {
      fromWalletId,
      amount,
      description,
      balance,
      previousBalance,
      toWalletId,
    } = event.payload;

    const entry = this.ledgerRepo.create({
      walletId: fromWalletId,
      referenceId: event.metadata?.correlationId || event.id,
      transactionType: TransactionType.TRANSFER_OUT,
      amount,
      balanceBefore: previousBalance || balance + amount,
      balanceAfter: balance,
      description: description || 'Transfer (initiated)',
      relatedWalletId: toWalletId,
      metadata: {
        eventId: event.id,
        eventType: event.eventType,
        toWalletId,
      },
    });

    await this.ledgerRepo.save(entry);
    this.logger.debug(
      `Created transfer debit entry for wallet ${fromWalletId}`,
    );
  }

  private async handleTransferCompleted(event: WalletEvent): Promise<void> {
    const {
      toWalletId,
      amount,
      description,
      balance,
      previousBalance,
      fromWalletId,
    } = event.payload;

    const entry = this.ledgerRepo.create({
      walletId: toWalletId,
      referenceId: event.metadata?.correlationId || event.id,
      transactionType: TransactionType.TRANSFER_IN,
      amount,
      balanceBefore: previousBalance || balance - amount,
      balanceAfter: balance,
      description: description || 'Transfer (completed)',
      relatedWalletId: fromWalletId,
      metadata: {
        eventId: event.id,
        eventType: event.eventType,
        fromWalletId,
      },
    });

    await this.ledgerRepo.save(entry);
    this.logger.debug(`Created transfer credit entry for wallet ${toWalletId}`);
  }

  /**
   * Check if event was already processed
   */
  private async isAlreadyProcessed(event: WalletEvent): Promise<boolean> {
    const checkpoint = await this.checkpointRepo.findOne({
      where: { projectorName: 'ledger-projector' },
    });

    if (!checkpoint) {
      return false;
    }

    // Check if we've already processed this event
    if (
      checkpoint.aggregateId === event.aggregateId &&
      checkpoint.lastProcessedVersion >= event.eventVersion
    ) {
      return true;
    }

    // Check by event ID
    if (
      checkpoint.lastProcessedId &&
      BigInt(checkpoint.lastProcessedId) >= BigInt(event.id)
    ) {
      return true;
    }

    // Check if ledger entry already exists for this transaction
    const exists = await this.ledgerRepo.findOne({
      where: { referenceId: event.id },
    });

    return !!exists;
  }

  /**
   * Save checkpoint
   */
  private async saveCheckpoint(event: WalletEvent): Promise<void> {
    await this.checkpointRepo.upsert(
      {
        projectorName: 'ledger-projector',
        aggregateId: event.aggregateId,
        lastProcessedVersion: event.eventVersion,
        lastProcessedId: event.id,
        lastProcessedAt: new Date(),
        updatedAt: new Date(),
      },
      ['projectorName'],
    );
  }
}
