import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutboxConsumerProcessing1730000000009
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create a new table to track which consumers have processed which events
    // This allows multiple consumers to process the same event independently
    await queryRunner.query(`
      CREATE TABLE outbox_consumer_processing (
        id BIGSERIAL PRIMARY KEY,
        outbox_event_id BIGINT NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
        consumer_name TEXT NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (outbox_event_id, consumer_name)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_outbox_consumer_processing_lookup 
      ON outbox_consumer_processing (outbox_event_id, consumer_name);
    `);

    // Remove the single consumer field from outbox (optional - can keep for legacy)
    // await queryRunner.query(`
    //   ALTER TABLE outbox DROP COLUMN IF EXISTS consumer;
    // `);

    // Remove the processed_at from outbox since processing is now per-consumer
    // Keep it for backward compatibility or legacy queries
    // await queryRunner.query(`
    //   ALTER TABLE outbox DROP COLUMN IF EXISTS processed_at;
    // `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS outbox_consumer_processing CASCADE;
    `);
  }
}

