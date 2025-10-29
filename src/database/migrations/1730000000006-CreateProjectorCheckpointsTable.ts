import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateProjectorCheckpointsTable1730000000006
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'projector_checkpoints',
        columns: [
          {
            name: 'projector_name',
            type: 'varchar',
            length: '100',
            isPrimary: true,
          },
          {
            name: 'aggregate_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
            comment: 'Last processed aggregate ID',
          },
          {
            name: 'last_processed_version',
            type: 'int',
            isNullable: false,
            default: 0,
          },
          {
            name: 'last_processed_id',
            type: 'bigint',
            isNullable: true,
            comment: 'Last processed outbox ID for cursor-based pagination',
          },
          {
            name: 'last_processed_at',
            type: 'timestamptz',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
            comment: 'Additional projector-specific state',
          },
        ],
      }),
      true,
    );

    // Index for monitoring stale projectors
    await queryRunner.createIndex(
      'projector_checkpoints',
      new TableIndex({
        name: 'idx_projector_updated',
        columnNames: ['updated_at'],
      }),
    );

    // Seed initial checkpoints for known projectors
    await queryRunner.query(`
      INSERT INTO projector_checkpoints (projector_name, last_processed_version, last_processed_id, metadata)
      VALUES 
        ('read-model-projector', 0, 0, '{"description": "Projects wallet events to read model"}'),
        ('ledger-projector', 0, 0, '{"description": "Projects wallet events to ledger entries"}')
      ON CONFLICT (projector_name) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('projector_checkpoints');
  }
}

