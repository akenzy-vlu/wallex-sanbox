import { DataSource } from 'typeorm';
import { dataSourceOptions } from './src/database/data-source';

/**
 * TypeORM configuration for CLI
 * Used by migration commands
 */
export default new DataSource(dataSourceOptions);
