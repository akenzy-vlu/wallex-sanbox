import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateHoldsTable1730000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'holds',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'wallet_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'amount',
            type: 'decimal',
            precision: 19,
            scale: 4,
            isNullable: false,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['ACTIVE', 'RELEASED', 'EXPIRED', 'CAPTURED'],
            default: "'ACTIVE'",
            isNullable: false,
          },
          {
            name: 'type',
            type: 'enum',
            enum: ['PAYMENT', 'AUTHORIZATION', 'REFUND', 'ESCROW', 'OTHER'],
            default: "'PAYMENT'",
            isNullable: false,
          },
          {
            name: 'reference',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'description',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'released_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'captured_at',
            type: 'timestamp',
            isNullable: true,
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

    // Enable UUID extension if not already enabled
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Create foreign key
    await queryRunner.createForeignKey(
      'holds',
      new TableForeignKey({
        name: 'FK_HOLDS_WALLET',
        columnNames: ['wallet_id'],
        referencedTableName: 'wallets',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      }),
    );

    // Create indexes
    await queryRunner.createIndex(
      'holds',
      new TableIndex({
        name: 'IDX_HOLDS_WALLET_ID',
        columnNames: ['wallet_id'],
      }),
    );

    await queryRunner.createIndex(
      'holds',
      new TableIndex({
        name: 'IDX_HOLDS_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'holds',
      new TableIndex({
        name: 'IDX_HOLDS_REFERENCE',
        columnNames: ['reference'],
      }),
    );

    await queryRunner.createIndex(
      'holds',
      new TableIndex({
        name: 'IDX_HOLDS_EXPIRES_AT',
        columnNames: ['expires_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('holds', 'IDX_HOLDS_EXPIRES_AT');
    await queryRunner.dropIndex('holds', 'IDX_HOLDS_REFERENCE');
    await queryRunner.dropIndex('holds', 'IDX_HOLDS_STATUS');
    await queryRunner.dropIndex('holds', 'IDX_HOLDS_WALLET_ID');
    await queryRunner.dropForeignKey('holds', 'FK_HOLDS_WALLET');
    await queryRunner.dropTable('holds');
  }
}
