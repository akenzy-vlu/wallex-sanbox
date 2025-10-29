import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  OneToMany,
} from 'typeorm';

export enum WalletStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

/**
 * Wallet Entity
 *
 * Represents a wallet with balance tracking, holds, and status management.
 * Uses optimistic locking via @VersionColumn for concurrency control.
 */
@Entity('wallets')
export class WalletEntity {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id: string;

  @Column({ type: 'varchar', length: 255, name: 'owner_id' })
  ownerId: string;

  @Column({
    type: 'decimal',
    precision: 19,
    scale: 4,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  balance: number;

  @Column({
    type: 'decimal',
    precision: 19,
    scale: 4,
    default: 0,
    name: 'held_balance',
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  heldBalance: number;

  @Column({
    type: 'decimal',
    precision: 19,
    scale: 4,
    default: 0,
    name: 'available_balance',
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  availableBalance: number;

  @Column({
    type: 'enum',
    enum: WalletStatus,
    default: WalletStatus.ACTIVE,
  })
  status: WalletStatus;

  @VersionColumn({ name: 'version' })
  version: number;

  @Column({ type: 'varchar', length: 3, default: 'USD', name: 'currency' })
  currency: string;

  @Column({ type: 'jsonb', nullable: true, name: 'metadata' })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany('HoldEntity', 'wallet')
  holds: any[];

  /**
   * Calculate available balance (balance - held balance)
   */
  calculateAvailableBalance(): number {
    return this.balance - this.heldBalance;
  }

  /**
   * Check if wallet can be debited
   */
  canDebit(amount: number): boolean {
    return (
      this.status === WalletStatus.ACTIVE && this.availableBalance >= amount
    );
  }

  /**
   * Check if wallet is active
   */
  isActive(): boolean {
    return this.status === WalletStatus.ACTIVE;
  }
}
