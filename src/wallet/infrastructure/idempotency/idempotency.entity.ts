import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum IdempotencyStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('idempotency_keys')
@Index('idx_idempotency_expires', ['expiresAt'])
@Index('idx_idempotency_status', ['status', 'createdAt'])
export class IdempotencyKey {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ type: 'jsonb' })
  response: Record<string, any>;

  @Column({
    type: 'varchar',
    length: 50,
    enum: IdempotencyStatus,
  })
  status: IdempotencyStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}

