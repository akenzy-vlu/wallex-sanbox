import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateLedgerEntriesTable1730000000003
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'ledger_entries',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'walletId',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'transactionType',
            type: 'enum',
            enum: ['CREDIT', 'DEBIT', 'TRANSFER_OUT', 'TRANSFER_IN'],
            isNullable: false,
          },
          {
            name: 'amount',
            type: 'decimal',
            precision: 20,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'balanceBefore',
            type: 'decimal',
            precision: 20,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'balanceAfter',
            type: 'decimal',
            precision: 20,
            scale: 2,
            isNullable: false,
          },
          {
            name: 'description',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'referenceId',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'relatedWalletId',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // Create indexes for better query performance
    await queryRunner.createIndex(
      'ledger_entries',
      new TableIndex({
        name: 'IDX_LEDGER_WALLET_ID',
        columnNames: ['walletId'],
      }),
    );

    await queryRunner.createIndex(
      'ledger_entries',
      new TableIndex({
        name: 'IDX_LEDGER_WALLET_CREATED',
        columnNames: ['walletId', 'createdAt'],
      }),
    );

    await queryRunner.createIndex(
      'ledger_entries',
      new TableIndex({
        name: 'IDX_LEDGER_TRANSACTION_TYPE_CREATED',
        columnNames: ['transactionType', 'createdAt'],
      }),
    );

    await queryRunner.createIndex(
      'ledger_entries',
      new TableIndex({
        name: 'IDX_LEDGER_REFERENCE_ID',
        columnNames: ['referenceId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ledger_entries');
  }
}

