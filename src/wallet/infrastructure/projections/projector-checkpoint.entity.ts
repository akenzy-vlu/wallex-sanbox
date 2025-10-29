import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('projector_checkpoints')
@Index('idx_projector_updated', ['updatedAt'])
export class ProjectorCheckpoint {
  @PrimaryColumn({ name: 'projector_name', type: 'varchar', length: 100 })
  projectorName: string;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 255, nullable: true })
  aggregateId: string | null;

  @Column({ name: 'last_processed_version', type: 'int', default: 0 })
  lastProcessedVersion: number;

  @Column({ name: 'last_processed_id', type: 'bigint', nullable: true })
  lastProcessedId: string | null;

  @CreateDateColumn({ name: 'last_processed_at', type: 'timestamptz' })
  lastProcessedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}

