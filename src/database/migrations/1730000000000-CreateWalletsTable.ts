import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateWalletsTable1730000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'wallets',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
          },
          {
            name: 'owner_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'balance',
            type: 'decimal',
            precision: 19,
            scale: 4,
            default: 0,
            isNullable: false,
          },
          {
            name: 'held_balance',
            type: 'decimal',
            precision: 19,
            scale: 4,
            default: 0,
            isNullable: false,
          },
          {
            name: 'available_balance',
            type: 'decimal',
            precision: 19,
            scale: 4,
            default: 0,
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['ACTIVE', 'SUSPENDED', 'CLOSED'],
            default: "'ACTIVE'",
            isNullable: false,
          },
          {
            name: 'version',
            type: 'integer',
            default: 0,
            isNullable: false,
          },
          {
            name: 'currency',
            type: 'varchar',
            length: '3',
            default: "'USD'",
            isNullable: false,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'wallets',
      new TableIndex({
        name: 'IDX_WALLETS_OWNER_ID',
        columnNames: ['owner_id'],
      }),
    );

    await queryRunner.createIndex(
      'wallets',
      new TableIndex({
        name: 'IDX_WALLETS_STATUS',
        columnNames: ['status'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('wallets', 'IDX_WALLETS_STATUS');
    await queryRunner.dropIndex('wallets', 'IDX_WALLETS_OWNER_ID');
    await queryRunner.dropTable('wallets');
  }
}
