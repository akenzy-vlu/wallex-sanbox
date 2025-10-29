import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateOutboxTable1730000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'outbox',
        columns: [
          {
            name: 'id',
            type: 'bigserial',
            isPrimary: true,
          },
          {
            name: 'aggregate_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'event_type',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'event_version',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'payload',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'processed_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'consumer',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Unique constraint to ensure idempotent event processing
    await queryRunner.query(`
      ALTER TABLE outbox 
      ADD CONSTRAINT uq_outbox_aggregate_event 
      UNIQUE (aggregate_id, event_version, event_type)
    `);

    // Index for polling unprocessed events
    await queryRunner.createIndex(
      'outbox',
      new TableIndex({
        name: 'idx_outbox_unprocessed',
        columnNames: ['created_at'],
        where: 'processed_at IS NULL',
      }),
    );

    // Index for consumer-specific polling
    await queryRunner.createIndex(
      'outbox',
      new TableIndex({
        name: 'idx_outbox_consumer',
        columnNames: ['consumer', 'processed_at'],
        where: 'processed_at IS NULL',
      }),
    );

    // Index for aggregate lookup
    await queryRunner.createIndex(
      'outbox',
      new TableIndex({
        name: 'idx_outbox_aggregate',
        columnNames: ['aggregate_id', 'event_version'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('outbox');
  }
}

