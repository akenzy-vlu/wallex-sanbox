import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  LedgerEntryEntity,
  TransactionType,
} from '../domain/entities/ledger-entry.entity';

export interface RecordEntryDto {
  walletId: string;
  transactionType: TransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description?: string;
  referenceId?: string;
  relatedWalletId?: string;
  metadata?: Record<string, any>;
}

export interface TransactionHistoryFilters {
  walletId?: string;
  transactionType?: TransactionType;
  startDate?: Date;
  endDate?: Date;
  referenceId?: string;
  limit?: number;
  offset?: number;
}

/**
 * LedgerService
 *
 * Application service for ledger operations.
 * Handles business logic for recording and querying transactions.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(
    @InjectRepository(LedgerEntryEntity)
    private readonly ledgerRepository: Repository<LedgerEntryEntity>,
    private readonly dataSource: DataSource,
  ) {
    this.logger.log('LedgerService initialized');
  }

  /**
   * Record a single transaction entry in the ledger
   */
  async recordEntry(data: RecordEntryDto): Promise<LedgerEntryEntity> {
    this.logger.debug(
      `Recording ledger entry for wallet ${data.walletId}: ${data.transactionType} ${data.amount}`,
    );

    const entry = this.ledgerRepository.create({
      walletId: data.walletId,
      transactionType: data.transactionType,
      amount: data.amount,
      balanceBefore: data.balanceBefore,
      balanceAfter: data.balanceAfter,
      description: data.description,
      referenceId: data.referenceId,
      relatedWalletId: data.relatedWalletId,
      metadata: data.metadata,
    });

    const savedEntry = await this.ledgerRepository.save(entry);
    this.logger.log(
      `Ledger entry created: ${savedEntry.id} for wallet ${data.walletId}`,
    );

    return savedEntry;
  }

  /**
   * Record multiple transaction entries in a single transaction
   * Useful for transfers where we need to record both debit and credit
   */
  async recordEntries(entries: RecordEntryDto[]): Promise<LedgerEntryEntity[]> {
    this.logger.debug(`Recording ${entries.length} ledger entries`);

    return await this.dataSource.transaction(async (manager) => {
      const ledgerEntries = entries.map((data) =>
        manager.create(LedgerEntryEntity, {
          walletId: data.walletId,
          transactionType: data.transactionType,
          amount: data.amount,
          balanceBefore: data.balanceBefore,
          balanceAfter: data.balanceAfter,
          description: data.description,
          referenceId: data.referenceId,
          relatedWalletId: data.relatedWalletId,
          metadata: data.metadata,
        }),
      );

      const savedEntries = await manager.save(LedgerEntryEntity, ledgerEntries);
      this.logger.log(`Recorded ${savedEntries.length} ledger entries`);

      return savedEntries;
    });
  }

  /**
   * Query transaction history with flexible filters
   */
  async getTransactionHistory(
    filters: TransactionHistoryFilters,
  ): Promise<LedgerEntryEntity[]> {
    this.logger.debug('Querying transaction history', filters);

    const query = this.ledgerRepository.createQueryBuilder('ledger');

    if (filters.walletId) {
      query.andWhere('ledger.walletId = :walletId', {
        walletId: filters.walletId,
      });
    }

    if (filters.transactionType) {
      query.andWhere('ledger.transactionType = :transactionType', {
        transactionType: filters.transactionType,
      });
    }

    if (filters.startDate) {
      query.andWhere('ledger.createdAt >= :startDate', {
        startDate: filters.startDate,
      });
    }

    if (filters.endDate) {
      query.andWhere('ledger.createdAt <= :endDate', {
        endDate: filters.endDate,
      });
    }

    if (filters.referenceId) {
      query.andWhere('ledger.referenceId = :referenceId', {
        referenceId: filters.referenceId,
      });
    }

    query.orderBy('ledger.createdAt', 'DESC');

    if (filters.limit) {
      query.limit(filters.limit);
    }

    if (filters.offset) {
      query.offset(filters.offset);
    }

    const entries = await query.getMany();
    this.logger.debug(`Found ${entries.length} ledger entries`);

    return entries;
  }

  /**
   * Get wallet balance summary from ledger
   */
  async getWalletBalanceSummary(walletId: string): Promise<{
    totalCredits: number;
    totalDebits: number;
    transactionCount: number;
    lastTransaction?: LedgerEntryEntity;
  }> {
    const entries = await this.getTransactionHistory({ walletId });

    const totalCredits = entries
      .filter(
        (e) =>
          e.transactionType === TransactionType.CREDIT ||
          e.transactionType === TransactionType.TRANSFER_IN,
      )
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const totalDebits = entries
      .filter(
        (e) =>
          e.transactionType === TransactionType.DEBIT ||
          e.transactionType === TransactionType.TRANSFER_OUT,
      )
      .reduce((sum, e) => sum + Number(e.amount), 0);

    return {
      totalCredits,
      totalDebits,
      transactionCount: entries.length,
      lastTransaction: entries[0],
    };
  }
}
