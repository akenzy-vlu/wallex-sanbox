import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { KurrentDBClient } from '@kurrent/kurrentdb-client';
import { Client, ClientOptions } from '@elastic/elasticsearch';
import { CreateWalletHandler } from './application/commands/handlers/create-wallet.handler';
import { CreditWalletHandler } from './application/commands/handlers/credit-wallet.handler';
import { DebitWalletHandler } from './application/commands/handlers/debit-wallet.handler';
import { TransferWalletHandler } from './application/commands/handlers/transfer-wallet.handler';
import { GetWalletHandler } from './application/queries/handlers/get-wallet.handler';
import { GetWalletsHandler } from './application/queries/handlers/get-wallets.handler';
import { EventStoreDbService } from './infrastructure/event-store/event-store.service';
import { KURRENTDB_CONNECTION } from './infrastructure/event-store/kurrentdb.tokens';
import { WalletProjectionService } from './infrastructure/projections/wallet-projection.service';
import {
  ELASTICSEARCH_CLIENT,
  WalletReadRepository,
} from './infrastructure/read-model/wallet-read.repository';
import { WalletController } from './interfaces/rest/wallet.controller';
import { DistributedLockService } from './infrastructure/lock/distributed-lock.service';
import { WalletSnapshotRepository } from './infrastructure/snapshots/wallet-snapshot.repository';
import { WalletSnapshotService } from './infrastructure/snapshots/wallet-snapshot.service';
import { WalletEntity } from './domain/entities/wallet.entity';
import { HoldEntity } from './domain/entities/hold.entity';
import { WalletRepository } from './infrastructure/persistence/wallet.repository';
import { HoldRepository } from './infrastructure/persistence/hold.repository';
import { LedgerModule } from '../ledger/ledger.module';

// New async projection infrastructure
import { OutboxEvent } from './infrastructure/outbox/outbox.entity';
import { OutboxService } from './infrastructure/outbox/outbox.service';
import { IdempotencyKey } from './infrastructure/idempotency/idempotency.entity';
import { IdempotencyService } from './infrastructure/idempotency/idempotency.service';
import { ProjectorCheckpoint } from './infrastructure/projections/projector-checkpoint.entity';
import { ReadModelProjector } from './infrastructure/projections/read-model.projector';
import { LedgerProjector } from './infrastructure/projections/ledger.projector';
import { ProjectorBootstrapService } from './infrastructure/projections/projector-bootstrap.service';
import { RecoveryService } from './infrastructure/recovery/recovery.service';
import { MetricsService } from './infrastructure/observability/metrics.service';
import { TracingService } from './infrastructure/observability/tracing.service';
import { Wallet } from './infrastructure/read-model/wallet.entity';
import { LedgerEntryEntity } from '../ledger/domain/entities/ledger-entry.entity';

// Kafka integration
import { KafkaModule } from '../kafka/kafka.module';
import { IntegrationModule } from '../integration/integration.module';
import { KafkaOutboxPublisherService } from '../kafka/kafka-outbox-publisher.service';
import { LedgerKafkaConsumer } from './infrastructure/projections/ledger-kafka.consumer';
import { ReadModelKafkaConsumer } from './infrastructure/projections/read-model-kafka.consumer';

const commandHandlers = [
  CreateWalletHandler,
  CreditWalletHandler,
  DebitWalletHandler,
  TransferWalletHandler,
];
const queryHandlers = [GetWalletHandler, GetWalletsHandler];

@Module({
  imports: [
    CqrsModule,
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      WalletEntity,
      HoldEntity,
      OutboxEvent,
      IdempotencyKey,
      ProjectorCheckpoint,
      Wallet,
      LedgerEntryEntity,
    ]),
    LedgerModule,
    KafkaModule, // Import Kafka module
    IntegrationModule,
  ],
  controllers: [WalletController],
  providers: [
    {
      provide: KURRENTDB_CONNECTION,
      useFactory: () =>
        KurrentDBClient.connectionString(
          process.env.KURRENTDB_CONNECTION_STRING ??
            'kurrentdb://localhost:2113?tls=false',
        ),
    },
    {
      provide: ELASTICSEARCH_CLIENT,
      useFactory: () => {
        const node = process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200';
        const apiKey = process.env.ELASTICSEARCH_API_KEY;
        const username = process.env.ELASTICSEARCH_USERNAME;
        const password = process.env.ELASTICSEARCH_PASSWORD;

        const clientOptions: ClientOptions = { node };

        if (apiKey) {
          clientOptions.auth = { apiKey };
        } else if (username && password) {
          clientOptions.auth = { username, password };
        }

        return new Client(clientOptions);
      },
    },
    EventStoreDbService,
    WalletProjectionService,
    WalletReadRepository,
    DistributedLockService,
    WalletSnapshotRepository,
    WalletSnapshotService,
    WalletRepository,
    HoldRepository,
    // New async projection infrastructure
    OutboxService,
    IdempotencyService,
    // Kafka-based projectors (replacing polling-based projectors)
    KafkaOutboxPublisherService,
    LedgerKafkaConsumer,
    ReadModelKafkaConsumer,
    // Keep old projectors for migration/fallback
    ReadModelProjector,
    LedgerProjector,
    ProjectorBootstrapService,
    RecoveryService,
    // Observability
    MetricsService,
    TracingService,
    ...commandHandlers,
    ...queryHandlers,
  ],
  exports: [
    WalletReadRepository,
    WalletRepository,
    HoldRepository,
    OutboxService,
    IdempotencyService,
    MetricsService,
    TracingService,
  ],
})
export class WalletModule {}
