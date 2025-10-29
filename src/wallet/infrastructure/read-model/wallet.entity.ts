import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Wallet read model entity (PostgreSQL)
 * 
 * This is the denormalized read model for fast queries.
 * Updated asynchronously by projector workers from event store.
 */
@Entity('wallets_read_model')
@Index(['ownerId'])
export class Wallet {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id: string;

  @Column({ name: 'owner_id', type: 'varchar', length: 255 })
  ownerId: string;

  @Column({ type: 'decimal', precision: 20, scale: 2, default: 0 })
  balance: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

