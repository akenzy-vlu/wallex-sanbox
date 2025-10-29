import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WalletEntity } from './wallet.entity';

export enum HoldStatus {
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
  EXPIRED = 'EXPIRED',
  CAPTURED = 'CAPTURED',
}

export enum HoldType {
  PAYMENT = 'PAYMENT',
  AUTHORIZATION = 'AUTHORIZATION',
  REFUND = 'REFUND',
  ESCROW = 'ESCROW',
  OTHER = 'OTHER',
}

/**
 * Hold Entity
 *
 * Represents a hold on wallet funds.
 * Holds temporarily reserve funds without actually debiting them.
 * Used for payment authorizations, escrow, etc.
 */
@Entity('holds')
export class HoldEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, name: 'wallet_id' })
  walletId: string;

  @ManyToOne(() => WalletEntity, (wallet) => wallet.holds)
  @JoinColumn({ name: 'wallet_id' })
  wallet: WalletEntity;

  @Column({
    type: 'decimal',
    precision: 19,
    scale: 4,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  amount: number;

  @Column({
    type: 'enum',
    enum: HoldStatus,
    default: HoldStatus.ACTIVE,
  })
  status: HoldStatus;

  @Column({
    type: 'enum',
    enum: HoldType,
    default: HoldType.PAYMENT,
  })
  type: HoldType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'expires_at' })
  expiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'released_at' })
  releasedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'captured_at' })
  capturedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * Check if hold is active
   */
  isActive(): boolean {
    return this.status === HoldStatus.ACTIVE;
  }

  /**
   * Check if hold is expired
   */
  isExpired(): boolean {
    if (this.status === HoldStatus.EXPIRED) {
      return true;
    }
    if (this.expiresAt && new Date() > this.expiresAt) {
      return true;
    }
    return false;
  }

  /**
   * Release the hold
   */
  release(): void {
    if (!this.isActive()) {
      throw new Error(`Cannot release hold in status: ${this.status}`);
    }
    this.status = HoldStatus.RELEASED;
    this.releasedAt = new Date();
  }

  /**
   * Capture the hold (convert to actual debit)
   */
  capture(): void {
    if (!this.isActive()) {
      throw new Error(`Cannot capture hold in status: ${this.status}`);
    }
    this.status = HoldStatus.CAPTURED;
    this.capturedAt = new Date();
  }

  /**
   * Mark hold as expired
   */
  expire(): void {
    if (!this.isActive()) {
      throw new Error(`Cannot expire hold in status: ${this.status}`);
    }
    this.status = HoldStatus.EXPIRED;
  }
}
