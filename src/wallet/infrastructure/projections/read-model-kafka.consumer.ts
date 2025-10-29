import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BaseKafkaConsumer,
  MessageContext,
} from '../../../kafka/kafka-consumer.base';
import { Wallet } from '../read-model/wallet.entity';
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
export class ReadModelKafkaConsumer extends BaseKafkaConsumer {
  constructor(
    configService: ConfigService,
    @InjectRepository(Wallet)
    private readonly walletReadRepo: Repository<Wallet>,
    @InjectRepository(ProjectorCheckpoint)
    private readonly checkpointRepo: Repository<ProjectorCheckpoint>,
    debugCapture: DebugCaptureService,
  ) {
    super(
      {
        groupId: 'read-model-projector',
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
   * Apply read model projection based on event type
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

    // Check if wallet already exists (idempotency)
    const existing = await this.walletReadRepo.findOne({
      where: { id: walletId },
    });

    if (existing) {
      this.logger.debug(
        `Wallet ${walletId} already exists in read model, skipping`,
      );
      return;
    }

    const wallet = this.walletReadRepo.create({
      id: walletId,
      ownerId,
      balance: initialBalance || 0,
    });

    await this.walletReadRepo.save(wallet);
    this.logger.debug(`Created read model for wallet ${walletId}`);
  }

  private async handleWalletCredited(event: WalletEvent): Promise<void> {
    const { walletId, balance } = event.payload;

    await this.walletReadRepo.update(
      { id: walletId },
      {
        balance,
      },
    );

    this.logger.debug(`Updated balance for wallet ${walletId} to ${balance}`);
  }

  private async handleWalletDebited(event: WalletEvent): Promise<void> {
    const { walletId, balance } = event.payload;

    await this.walletReadRepo.update(
      { id: walletId },
      {
        balance,
      },
    );

    this.logger.debug(`Updated balance for wallet ${walletId} to ${balance}`);
  }

  private async handleTransferInitiated(event: WalletEvent): Promise<void> {
    const { fromWalletId, balance } = event.payload;

    await this.walletReadRepo.update(
      { id: fromWalletId },
      {
        balance,
      },
    );

    this.logger.debug(
      `Updated balance for wallet ${fromWalletId} to ${balance}`,
    );
  }

  private async handleTransferCompleted(event: WalletEvent): Promise<void> {
    const { toWalletId, balance } = event.payload;

    await this.walletReadRepo.update(
      { id: toWalletId },
      {
        balance,
      },
    );

    this.logger.debug(`Updated balance for wallet ${toWalletId} to ${balance}`);
  }

  /**
   * Check if event was already processed
   */
  private async isAlreadyProcessed(event: WalletEvent): Promise<boolean> {
    const checkpoint = await this.checkpointRepo.findOne({
      where: { projectorName: 'read-model-projector' },
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

    return false;
  }

  /**
   * Save checkpoint
   */
  private async saveCheckpoint(event: WalletEvent): Promise<void> {
    await this.checkpointRepo.upsert(
      {
        projectorName: 'read-model-projector',
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
