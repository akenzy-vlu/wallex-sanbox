import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import {
  WalletEntity,
  WalletStatus,
} from '../../domain/entities/wallet.entity';
import {
  WalletNotFoundError,
  WalletAlreadyExistsError,
  InsufficientFundsError,
  EventConcurrencyError,
} from '../../domain/errors';

/**
 * WalletRepository
 *
 * Repository for wallet persistence operations.
 * Provides transactional support and optimistic locking.
 */
@Injectable()
export class WalletRepository {
  private readonly logger = new Logger(WalletRepository.name);

  constructor(
    @InjectRepository(WalletEntity)
    private readonly repository: Repository<WalletEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Create a new wallet
   */
  async create(
    walletId: string,
    ownerId: string,
    initialBalance = 0,
    currency = 'USD',
  ): Promise<WalletEntity> {
    const exists = await this.repository.findOne({ where: { id: walletId } });
    if (exists) {
      throw new WalletAlreadyExistsError(walletId);
    }

    const wallet = this.repository.create({
      id: walletId,
      ownerId,
      balance: initialBalance,
      heldBalance: 0,
      availableBalance: initialBalance,
      status: WalletStatus.ACTIVE,
      currency,
      version: 0,
    });

    const saved = await this.repository.save(wallet);
    this.logger.log(`Wallet created: ${walletId}`);
    return saved;
  }

  /**
   * Find wallet by ID
   */
  async findById(walletId: string): Promise<WalletEntity | null> {
    return this.repository.findOne({ where: { id: walletId } });
  }

  /**
   * Find wallet by ID or throw error
   */
  async findByIdOrFail(walletId: string): Promise<WalletEntity> {
    const wallet = await this.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }
    return wallet;
  }

  /**
   * Find wallets by owner ID
   */
  async findByOwnerId(ownerId: string): Promise<WalletEntity[]> {
    return this.repository.find({ where: { ownerId } });
  }

  /**
   * Credit wallet (add funds)
   * Note: Concurrency is handled by distributed lock at the handler level
   */
  async credit(
    walletId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<WalletEntity> {
    const repo = manager
      ? manager.getRepository(WalletEntity)
      : this.repository;

    const wallet = await repo.findOne({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    wallet.balance += amount;
    wallet.availableBalance = wallet.calculateAvailableBalance();

    const saved = await repo.save(wallet);
    this.logger.log(`Wallet ${walletId} credited: ${amount}`);
    return saved;
  }

  /**
   * Debit wallet (remove funds)
   * Note: Concurrency is handled by distributed lock at the handler level
   */
  async debit(
    walletId: string,
    amount: number,
    manager?: EntityManager,
  ): Promise<WalletEntity> {
    const repo = manager
      ? manager.getRepository(WalletEntity)
      : this.repository;

    const wallet = await repo.findOne({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    if (!wallet.canDebit(amount)) {
      throw new InsufficientFundsError(
        walletId,
        wallet.availableBalance,
        amount,
      );
    }

    wallet.balance -= amount;
    wallet.availableBalance = wallet.calculateAvailableBalance();

    const saved = await repo.save(wallet);
    this.logger.log(`Wallet ${walletId} debited: ${amount}`);
    return saved;
  }

  /**
   * Update wallet with version check (optimistic locking)
   */
  async updateWithVersionCheck(
    walletId: string,
    expectedVersion: number,
    updates: Partial<WalletEntity>,
  ): Promise<WalletEntity> {
    const wallet = await this.findByIdOrFail(walletId);

    if (wallet.version !== expectedVersion) {
      throw new EventConcurrencyError(expectedVersion, wallet.version);
    }

    Object.assign(wallet, updates);
    return this.repository.save(wallet);
  }

  /**
   * Update wallet status
   */
  async updateStatus(
    walletId: string,
    status: WalletStatus,
    manager?: EntityManager,
  ): Promise<WalletEntity> {
    const repo = manager
      ? manager.getRepository(WalletEntity)
      : this.repository;
    const wallet = await this.findByIdOrFail(walletId);
    wallet.status = status;
    return repo.save(wallet);
  }

  /**
   * Execute operation in transaction
   */
  async transaction<T>(
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(operation);
  }

  /**
   * Transfer funds between wallets
   */
  async transfer(
    fromWalletId: string,
    toWalletId: string,
    amount: number,
  ): Promise<{ from: WalletEntity; to: WalletEntity }> {
    return this.transaction(async (manager) => {
      const from = await this.debit(fromWalletId, amount, manager);
      const to = await this.credit(toWalletId, amount, manager);

      this.logger.log(
        `Transfer ${amount} from ${fromWalletId} to ${toWalletId}`,
      );
      return { from, to };
    });
  }

  /**
   * Get wallet with holds
   */
  async findByIdWithHolds(walletId: string): Promise<WalletEntity | null> {
    return this.repository.findOne({
      where: { id: walletId },
      relations: ['holds'],
    });
  }

  /**
   * Update held balance
   */
  async updateHeldBalance(
    walletId: string,
    heldBalance: number,
    manager?: EntityManager,
  ): Promise<WalletEntity> {
    const repo = manager
      ? manager.getRepository(WalletEntity)
      : this.repository;
    const wallet = await this.findByIdOrFail(walletId);
    wallet.heldBalance = heldBalance;
    wallet.availableBalance = wallet.calculateAvailableBalance();
    return repo.save(wallet);
  }
}
