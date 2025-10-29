import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WalletEntity } from '../wallet/domain/entities/wallet.entity';
import { HoldEntity } from '../wallet/domain/entities/hold.entity';
import { LedgerEntryEntity } from '../ledger/domain/entities/ledger-entry.entity';

/**
 * DatabaseModule
 *
 * Configures TypeORM with PostgreSQL connection.
 * Handles database connection, migrations, and entity management.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // Handle SSL configuration properly
        // Environment variables come as strings, so "false" would be truthy
        const sslConfig = configService.get<string>('DB_SSL', 'false');
        const enableSsl = sslConfig === 'true';

        const dataSourceOptions = {
          type: 'postgres',
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USERNAME', 'postgres'),
          password: configService.get<string>('DB_PASSWORD', 'postgres'),
          database: configService.get<string>('DB_NAME', 'wallex'),
          entities: [WalletEntity, HoldEntity, LedgerEntryEntity],
          synchronize: configService.get<boolean>('DB_SYNC', false),
          logging: configService.get<boolean>('DB_LOGGING', false),
          migrations: ['dist/database/migrations/*.js'],
          migrationsRun: configService.get<boolean>('DB_RUN_MIGRATIONS', false),
          ssl: enableSsl ? { rejectUnauthorized: false } : false,
        };

        return {
          ...dataSourceOptions,
          type: 'postgres' as const,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
