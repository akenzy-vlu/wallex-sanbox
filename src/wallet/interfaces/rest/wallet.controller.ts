import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  EventConcurrencyError,
  InvalidAmountError,
  InsufficientFundsError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
} from '../../domain/errors';
import { CreateWalletCommand } from '../../application/commands/create-wallet.command';
import { CreditWalletCommand } from '../../application/commands/credit-wallet.command';
import { DebitWalletCommand } from '../../application/commands/debit-wallet.command';
import { TransferWalletCommand } from '../../application/commands/transfer-wallet.command';
import { GetWalletQuery } from '../../application/queries/get-wallet.query';
import { GetWalletsQuery } from '../../application/queries/get-wallets.query';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { MutateWalletBalanceDto } from './dto/mutate-wallet-balance.dto';
import { TransferWalletDto } from './dto/transfer-wallet.dto';
import { WalletReadModel } from '../../infrastructure/read-model/wallet-read.repository';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  async createWallet(@Body() dto: CreateWalletDto): Promise<WalletReadModel> {
    if (!dto.walletId || !dto.ownerId) {
      throw new BadRequestException('walletId and ownerId are required');
    }

    const initialBalance = dto.initialBalance ?? 0;

    try {
      await this.commandBus.execute(
        new CreateWalletCommand(dto.walletId, dto.ownerId, initialBalance),
      );
    } catch (error) {
      this.handleError(error);
    }

    return this.fetchWalletOrThrow(dto.walletId);
  }

  @Post(':walletId/credit')
  async creditWallet(
    @Param('walletId') walletId: string,
    @Body() dto: MutateWalletBalanceDto,
  ): Promise<WalletReadModel> {
    if (!walletId) {
      throw new BadRequestException('walletId is required');
    }

    try {
      await this.commandBus.execute(
        new CreditWalletCommand(walletId, dto.amount, dto.description),
      );
    } catch (error) {
      this.handleError(error);
    }

    return this.fetchWalletOrThrow(walletId);
  }

  @Post(':walletId/debit')
  async debitWallet(
    @Param('walletId') walletId: string,
    @Body() dto: MutateWalletBalanceDto,
  ): Promise<WalletReadModel> {
    if (!walletId) {
      throw new BadRequestException('walletId is required');
    }

    try {
      await this.commandBus.execute(
        new DebitWalletCommand(walletId, dto.amount, dto.description),
      );
    } catch (error) {
      this.handleError(error);
    }

    return this.fetchWalletOrThrow(walletId);
  }

  @Post(':fromWalletId/transfer')
  async transferWallet(
    @Param('fromWalletId') fromWalletId: string,
    @Body() dto: TransferWalletDto,
  ): Promise<{ fromWallet: WalletReadModel; toWallet: WalletReadModel }> {
    if (!fromWalletId) {
      throw new BadRequestException('fromWalletId is required');
    }

    if (!dto.toWalletId) {
      throw new BadRequestException('toWalletId is required');
    }

    try {
      await this.commandBus.execute(
        new TransferWalletCommand(
          fromWalletId,
          dto.toWalletId,
          dto.amount,
          dto.description,
        ),
      );
    } catch (error) {
      this.handleError(error);
    }

    const fromWallet = await this.fetchWalletOrThrow(fromWalletId);
    const toWallet = await this.fetchWalletOrThrow(dto.toWalletId);

    return { fromWallet, toWallet };
  }

  @Get()
  getWallets(): Promise<WalletReadModel[]> {
    return this.queryBus.execute<GetWalletsQuery, WalletReadModel[]>(
      new GetWalletsQuery(),
    );
  }

  @Get(':walletId')
  getWallet(@Param('walletId') walletId: string): Promise<WalletReadModel> {
    return this.fetchWalletOrThrow(walletId);
  }

  private async fetchWalletOrThrow(walletId: string): Promise<WalletReadModel> {
    const document = await this.queryBus.execute<
      GetWalletQuery,
      WalletReadModel | null
    >(new GetWalletQuery(walletId));

    if (!document) {
      throw new NotFoundException(`Wallet ${walletId} not found`);
    }

    return document;
  }

  private handleError(error: unknown): never {
    if (
      error instanceof WalletAlreadyExistsError ||
      error instanceof EventConcurrencyError
    ) {
      throw new ConflictException(error.message);
    }

    if (
      error instanceof WalletNotFoundError ||
      (error instanceof NotFoundException && error.message.includes('Wallet'))
    ) {
      throw new NotFoundException(error.message);
    }

    if (
      error instanceof InvalidAmountError ||
      error instanceof InsufficientFundsError
    ) {
      throw new BadRequestException(error.message);
    }

    if (error instanceof BadRequestException) {
      throw error;
    }

    throw error instanceof Error ? error : new Error('Unknown error');
  }
}
