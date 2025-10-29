import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, LessThan } from 'typeorm';
import {
  HoldEntity,
  HoldStatus,
  HoldType,
} from '../../domain/entities/hold.entity';

export interface CreateHoldDto {
  walletId: string;
  amount: number;
  type: HoldType;
  reference?: string;
  description?: string;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * HoldRepository
 *
 * Repository for hold persistence operations.
 * Manages fund holds on wallets.
 */
@Injectable()
export class HoldRepository {
  private readonly logger = new Logger(HoldRepository.name);

  constructor(
    @InjectRepository(HoldEntity)
    private readonly repository: Repository<HoldEntity>,
  ) {}

  /**
   * Create a new hold
   */
  async create(
    data: CreateHoldDto,
    manager?: EntityManager,
  ): Promise<HoldEntity> {
    const repo = manager ? manager.getRepository(HoldEntity) : this.repository;

    const hold = repo.create({
      walletId: data.walletId,
      amount: data.amount,
      type: data.type,
      reference: data.reference || null,
      description: data.description || null,
      expiresAt: data.expiresAt || null,
      metadata: data.metadata || null,
      status: HoldStatus.ACTIVE,
    });

    const saved = await repo.save(hold);
    this.logger.log(`Hold created: ${saved.id} on wallet ${data.walletId}`);
    return saved;
  }

  /**
   * Find hold by ID
   */
  async findById(holdId: string): Promise<HoldEntity | null> {
    return this.repository.findOne({ where: { id: holdId } });
  }

  /**
   * Find hold by ID or throw
   */
  async findByIdOrFail(holdId: string): Promise<HoldEntity> {
    const hold = await this.findById(holdId);
    if (!hold) {
      throw new Error(`Hold ${holdId} not found`);
    }
    return hold;
  }

  /**
   * Find holds by wallet ID
   */
  async findByWalletId(walletId: string): Promise<HoldEntity[]> {
    return this.repository.find({
      where: { walletId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find active holds by wallet ID
   */
  async findActiveByWalletId(walletId: string): Promise<HoldEntity[]> {
    return this.repository.find({
      where: { walletId, status: HoldStatus.ACTIVE },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Find hold by reference
   */
  async findByReference(reference: string): Promise<HoldEntity | null> {
    return this.repository.findOne({ where: { reference } });
  }

  /**
   * Release a hold
   */
  async release(holdId: string, manager?: EntityManager): Promise<HoldEntity> {
    const repo = manager ? manager.getRepository(HoldEntity) : this.repository;
    const hold = await this.findByIdOrFail(holdId);
    hold.release();
    const saved = await repo.save(hold);
    this.logger.log(`Hold released: ${holdId}`);
    return saved;
  }

  /**
   * Capture a hold (convert to actual debit)
   */
  async capture(holdId: string, manager?: EntityManager): Promise<HoldEntity> {
    const repo = manager ? manager.getRepository(HoldEntity) : this.repository;
    const hold = await this.findByIdOrFail(holdId);
    hold.capture();
    const saved = await repo.save(hold);
    this.logger.log(`Hold captured: ${holdId}`);
    return saved;
  }

  /**
   * Expire a hold
   */
  async expire(holdId: string, manager?: EntityManager): Promise<HoldEntity> {
    const repo = manager ? manager.getRepository(HoldEntity) : this.repository;
    const hold = await this.findByIdOrFail(holdId);
    hold.expire();
    const saved = await repo.save(hold);
    this.logger.log(`Hold expired: ${holdId}`);
    return saved;
  }

  /**
   * Calculate total active holds for a wallet
   */
  async calculateTotalActiveHolds(
    walletId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repo = manager ? manager.getRepository(HoldEntity) : this.repository;

    const result = await repo
      .createQueryBuilder('hold')
      .select('SUM(hold.amount)', 'total')
      .where('hold.wallet_id = :walletId', { walletId })
      .andWhere('hold.status = :status', { status: HoldStatus.ACTIVE })
      .getRawOne();

    return parseFloat(result?.total || '0');
  }

  /**
   * Find expired holds that are still active
   */
  async findExpiredActiveHolds(): Promise<HoldEntity[]> {
    return this.repository.find({
      where: {
        status: HoldStatus.ACTIVE,
        expiresAt: LessThan(new Date()),
      },
    });
  }

  /**
   * Bulk expire holds
   */
  async bulkExpire(holdIds: string[]): Promise<void> {
    await this.repository.update(
      { id: In(holdIds) as any },
      {
        status: HoldStatus.EXPIRED,
      },
    );
    this.logger.log(`Bulk expired ${holdIds.length} holds`);
  }
}

// Import In operator
import { In } from 'typeorm';
