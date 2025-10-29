import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeWalletIdToVarchar1730000000002
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraint from holds table
    await queryRunner.query(
      `ALTER TABLE "holds" DROP CONSTRAINT "FK_HOLDS_WALLET"`,
    );

    // Change wallet_id in holds table from uuid to varchar
    await queryRunner.query(
      `ALTER TABLE "holds" ALTER COLUMN "wallet_id" TYPE varchar(255)`,
    );

    // Change id in wallets table from uuid to varchar
    await queryRunner.query(
      `ALTER TABLE "wallets" ALTER COLUMN "id" TYPE varchar(255)`,
    );

    // Recreate foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "holds" ADD CONSTRAINT "FK_HOLDS_WALLET" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "holds" DROP CONSTRAINT "FK_HOLDS_WALLET"`,
    );

    // Change id in wallets table from varchar to uuid
    await queryRunner.query(
      `ALTER TABLE "wallets" ALTER COLUMN "id" TYPE uuid USING id::uuid`,
    );

    // Change wallet_id in holds table from varchar to uuid
    await queryRunner.query(
      `ALTER TABLE "holds" ALTER COLUMN "wallet_id" TYPE uuid USING wallet_id::uuid`,
    );

    // Recreate foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "holds" ADD CONSTRAINT "FK_HOLDS_WALLET" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }
}
