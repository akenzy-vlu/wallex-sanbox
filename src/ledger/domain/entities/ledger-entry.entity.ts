import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum TransactionType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
  TRANSFER_OUT = 'TRANSFER_OUT',
  TRANSFER_IN = 'TRANSFER_IN',
}

@Entity('ledger_entries')
@Index(['walletId', 'createdAt'])
@Index(['transactionType', 'createdAt'])
@Index(['referenceId'])
export class LedgerEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  walletId: string;

  @Column({
    type: 'enum',
    enum: TransactionType,
  })
  transactionType: TransactionType;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  balanceBefore: number;

  @Column({ type: 'decimal', precision: 20, scale: 2 })
  balanceAfter: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  referenceId: string; // For linking related transactions (e.g., transfer transactions)

  @Column({ type: 'varchar', length: 255, nullable: true })
  relatedWalletId: string; // For transfers, the other wallet involved

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
