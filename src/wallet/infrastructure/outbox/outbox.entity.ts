import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('outbox')
@Index('idx_outbox_unprocessed', ['createdAt'], {
  where: 'processed_at IS NULL',
})
@Index('idx_outbox_consumer', ['consumer', 'processedAt'], {
  where: 'processed_at IS NULL',
})
@Index('idx_outbox_aggregate', ['aggregateId', 'eventVersion'])
export class OutboxEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 255 })
  aggregateId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 255 })
  eventType: string;

  @Column({ name: 'event_version', type: 'int' })
  eventVersion: number;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ type: 'jsonb' })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  consumer: string | null;
}

