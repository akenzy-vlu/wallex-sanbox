import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateIdempotencyTable1730000000005
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'idempotency_keys',
        columns: [
          {
            name: 'key',
            type: 'varchar',
            length: '255',
            isPrimary: true,
          },
          {
            name: 'request_hash',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'response',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            isNullable: false,
            comment: 'pending, completed, failed',
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'expires_at',
            type: 'timestamptz',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Index for cleanup of expired keys
    await queryRunner.createIndex(
      'idempotency_keys',
      new TableIndex({
        name: 'idx_idempotency_expires',
        columnNames: ['expires_at'],
      }),
    );

    // Index for status lookup
    await queryRunner.createIndex(
      'idempotency_keys',
      new TableIndex({
        name: 'idx_idempotency_status',
        columnNames: ['status', 'created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('idempotency_keys');
  }
}

