import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { WalletModule } from './wallet/wallet.module';
import { LedgerModule } from './ledger/ledger.module';
import { IntegrationModule } from './integration/integration.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    CqrsModule.forRoot(),
    DatabaseModule,
    WalletModule,
    LedgerModule,
    IntegrationModule,
    UserModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
