import { DataSource, DataSourceOptions } from 'typeorm';
import { WalletEntity } from '../wallet/domain/entities/wallet.entity';
import { HoldEntity } from '../wallet/domain/entities/hold.entity';
import { LedgerEntryEntity } from '../ledger/domain/entities/ledger-entry.entity';

/**
 * TypeORM DataSource configuration
 * Used for CLI migrations
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5434'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'wallex',
  entities: [WalletEntity, HoldEntity, LedgerEntryEntity],
  migrations: [__dirname + '/migrations/*.ts', __dirname + '/migrations/*.js'],
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
};

const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
