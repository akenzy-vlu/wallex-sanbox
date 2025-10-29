import { Controller, Get, Logger, Query, Param } from '@nestjs/common';
import {
  LedgerService,
  TransactionHistoryFilters,
} from '../../application/ledger.service';
import { TransactionType } from '../../domain/entities/ledger-entry.entity';

/**
 * LedgerController
 *
 * REST API endpoints for ledger operations
 */
@Controller('ledger')
export class LedgerController {
  private readonly logger = new Logger(LedgerController.name);

  constructor(private readonly ledgerService: LedgerService) {}

  @Get('health')
  health(): { status: string; module: string } {
    return { status: 'ok', module: 'ledger' };
  }

  /**
   * Get transaction history for a wallet
   * GET /ledger/wallet/:walletId
   */
  @Get('wallet/:walletId')
  async getWalletTransactions(
    @Param('walletId') walletId: string,
    @Query('transactionType') transactionType?: TransactionType,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.logger.log(`Getting transaction history for wallet: ${walletId}`);

    const filters: TransactionHistoryFilters = {
      walletId,
      transactionType,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    };

    const transactions =
      await this.ledgerService.getTransactionHistory(filters);

    return {
      walletId,
      count: transactions.length,
      transactions,
    };
  }

  /**
   * Get wallet balance summary from ledger
   * GET /ledger/wallet/:walletId/summary
   */
  @Get('wallet/:walletId/summary')
  async getWalletBalanceSummary(@Param('walletId') walletId: string) {
    this.logger.log(`Getting balance summary for wallet: ${walletId}`);

    const summary = await this.ledgerService.getWalletBalanceSummary(walletId);

    return {
      walletId,
      ...summary,
    };
  }

  /**
   * Get transactions by reference ID (useful for finding related transfer transactions)
   * GET /ledger/reference/:referenceId
   */
  @Get('reference/:referenceId')
  async getTransactionsByReference(@Param('referenceId') referenceId: string) {
    this.logger.log(`Getting transactions for reference: ${referenceId}`);

    const transactions = await this.ledgerService.getTransactionHistory({
      referenceId,
    });

    return {
      referenceId,
      count: transactions.length,
      transactions,
    };
  }

  /**
   * Get all transactions with filters
   * GET /ledger/transactions
   */
  @Get('transactions')
  async getAllTransactions(
    @Query('transactionType') transactionType?: TransactionType,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.logger.log('Getting all transactions with filters');

    const filters: TransactionHistoryFilters = {
      transactionType,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    };

    const transactions =
      await this.ledgerService.getTransactionHistory(filters);

    return {
      count: transactions.length,
      transactions,
    };
  }
}
