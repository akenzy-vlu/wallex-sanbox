import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BaseProjectorWorker,
  ProjectorConfig,
} from './base-projector.worker';
import { OutboxMessage, OutboxService } from '../outbox/outbox.service';
import { ProjectorCheckpoint } from './projector-checkpoint.entity';
import { Wallet } from '../read-model/wallet.entity';

@Injectable()
export class ReadModelProjector extends BaseProjectorWorker {
  constructor(
    outboxService: OutboxService,
    @InjectRepository(ProjectorCheckpoint)
    checkpointRepo: Repository<ProjectorCheckpoint>,
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
  ) {
    const config: ProjectorConfig = {
      name: 'read-model-projector',
      batchSize: 200,
      pollIntervalMs: 1000,
      errorBackoffMs: 5000,
      maxRetries: 3,
    };
    super(config, outboxService, checkpointRepo);
  }

  protected async apply(message: OutboxMessage): Promise<void> {
    const { eventType, payload, aggregateId } = message;

    switch (eventType) {
      case 'WalletCreated':
        await this.handleWalletCreated(aggregateId, payload);
        break;

      case 'WalletCredited':
        await this.handleWalletCredited(aggregateId, payload);
        break;

      case 'WalletDebited':
        await this.handleWalletDebited(aggregateId, payload);
        break;

      default:
        this.logger.warn(`Unknown event type: ${eventType}`);
    }
  }

  private async handleWalletCreated(
    walletId: string,
    payload: any,
  ): Promise<void> {
    const { ownerId, initialBalance } = payload.data;

    // Upsert to handle replay scenarios
    await this.walletRepo.upsert(
      {
        id: walletId,
        ownerId,
        balance: initialBalance || 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      ['id'],
    );

    this.logger.debug(`Read model updated: WalletCreated ${walletId}`);
  }

  private async handleWalletCredited(
    walletId: string,
    payload: any,
  ): Promise<void> {
    const { amount } = payload.data;

    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) {
      this.logger.warn(
        `Wallet ${walletId} not found in read model for credit`,
      );
      return;
    }

    wallet.balance += amount;
    wallet.updatedAt = new Date();

    await this.walletRepo.save(wallet);

    this.logger.debug(
      `Read model updated: WalletCredited ${walletId} +${amount}`,
    );
  }

  private async handleWalletDebited(
    walletId: string,
    payload: any,
  ): Promise<void> {
    const { amount } = payload.data;

    const wallet = await this.walletRepo.findOne({ where: { id: walletId } });
    if (!wallet) {
      this.logger.warn(`Wallet ${walletId} not found in read model for debit`);
      return;
    }

    wallet.balance -= amount;
    wallet.updatedAt = new Date();

    await this.walletRepo.save(wallet);

    this.logger.debug(
      `Read model updated: WalletDebited ${walletId} -${amount}`,
    );
  }
}

