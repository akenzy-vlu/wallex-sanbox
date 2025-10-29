import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerService } from './application/ledger.service';
import { LedgerController } from './interfaces/rest/ledger.controller';
import { LedgerEntryEntity } from './domain/entities/ledger-entry.entity';
import { LedgerProjectionService } from './application/ledger-projection.service';
import { WalletCreatedEventHandler } from './application/event-handlers/wallet-created.handler';
import { WalletCreditedEventHandler } from './application/event-handlers/wallet-credited.handler';
import { WalletDebitedEventHandler } from './application/event-handlers/wallet-debited.handler';

/**
 * LedgerModule
 *
 * Responsible for:
 * - Recording all financial transactions via event projection
 * - Maintaining audit trails
 * - Transaction history queries
 * - Ledger reconciliation
 *
 * Architecture:
 * - Subscribes to wallet events from the event store
 * - Projects events to ledger entries (event-driven)
 * - No direct coupling with wallet module
 *
 * Provider boundaries:
 * - Application layer: Business logic and event handlers
 * - Domain layer: Ledger entities
 * - Infrastructure layer: Persistence
 * - Interface layer: REST API controllers
 */
@Module({
  imports: [CqrsModule, TypeOrmModule.forFeature([LedgerEntryEntity])],
  controllers: [LedgerController],
  providers: [
    LedgerService,
    LedgerProjectionService,
    WalletCreatedEventHandler,
    WalletCreditedEventHandler,
    WalletDebitedEventHandler,
  ],
  exports: [LedgerProjectionService],
})
export class LedgerModule {}
