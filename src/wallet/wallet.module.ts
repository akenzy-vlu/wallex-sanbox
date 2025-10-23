import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
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

const commandHandlers = [
  CreateWalletHandler,
  CreditWalletHandler,
  DebitWalletHandler,
  TransferWalletHandler,
];
const queryHandlers = [GetWalletHandler, GetWalletsHandler];

@Module({
  imports: [CqrsModule],
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
    ...commandHandlers,
    ...queryHandlers,
  ],
  exports: [WalletReadRepository],
})
export class WalletModule {}
