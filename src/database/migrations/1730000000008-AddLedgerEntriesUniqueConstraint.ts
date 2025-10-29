import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLedgerEntriesUniqueConstraint1730000000008
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add unique constraint on referenceId to ensure idempotent ledger entries
    // This prevents duplicate entries if events are replayed
    await queryRunner.query(`
      ALTER TABLE ledger_entries
      ADD CONSTRAINT uq_ledger_entries_reference_id
      UNIQUE ("referenceId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ledger_entries
      DROP CONSTRAINT IF EXISTS uq_ledger_entries_reference_id;
    `);
  }
}
