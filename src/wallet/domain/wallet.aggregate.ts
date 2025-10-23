import { InvalidAmountError, InsufficientFundsError } from './errors';
import { StoredWalletEvent, WalletDomainEvent } from './events';

interface WalletState {
  id: string;
  ownerId: string;
  balance: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export class WalletAggregate {
  private readonly pendingEvents: WalletDomainEvent[] = [];
  private state: WalletState | null = null;
  private version = -1;
  private persistedVersion = -1;

  private constructor(private readonly id: string) {}

  static create(
    walletId: string,
    ownerId: string,
    initialBalance = 0,
  ): WalletAggregate {
    if (initialBalance < 0) {
      throw new InvalidAmountError(initialBalance);
    }

    const aggregate = new WalletAggregate(walletId);
    aggregate.applyNewEvent({
      type: 'WalletCreated',
      aggregateId: walletId,
      data: { ownerId, initialBalance: initialBalance || undefined },
    });

    if (initialBalance > 0) {
      aggregate.applyNewEvent({
        type: 'WalletCredited',
        aggregateId: walletId,
        data: { amount: initialBalance, description: 'Initial balance' },
      });
    }

    return aggregate;
  }

  static rehydrate(
    walletId: string,
    events: StoredWalletEvent[],
  ): WalletAggregate {
    const aggregate = new WalletAggregate(walletId);
    events.forEach((event) => aggregate.applyHistoricalEvent(event));
    aggregate.clearPendingEvents();
    return aggregate;
  }

  static rehydrateFromSnapshot(
    walletId: string,
    snapshotState: WalletState,
    snapshotVersion: number,
    eventsAfterSnapshot: StoredWalletEvent[],
  ): WalletAggregate {
    const aggregate = new WalletAggregate(walletId);

    // Restore state from snapshot
    aggregate.state = { ...snapshotState };
    aggregate.version = snapshotVersion;
    aggregate.persistedVersion = snapshotVersion;

    // Apply events after snapshot
    eventsAfterSnapshot.forEach((event) =>
      aggregate.applyHistoricalEvent(event),
    );
    aggregate.clearPendingEvents();

    return aggregate;
  }

  credit(amount: number, description?: string): void {
    this.ensureInitialized();
    this.ensureValidAmount(amount);

    this.applyNewEvent({
      type: 'WalletCredited',
      aggregateId: this.id,
      data: { amount, description },
    });
  }

  debit(amount: number, description?: string): void {
    this.ensureInitialized();
    this.ensureValidAmount(amount);

    const balance = this.state?.balance ?? 0;
    if (amount > balance) {
      throw new InsufficientFundsError(this.id, balance, amount);
    }

    this.applyNewEvent({
      type: 'WalletDebited',
      aggregateId: this.id,
      data: { amount, description },
    });
  }

  getPendingEvents(): WalletDomainEvent[] {
    return [...this.pendingEvents];
  }

  markEventsCommitted(): void {
    this.persistedVersion = this.version;
    this.clearPendingEvents();
  }

  getPersistedVersion(): number {
    return this.persistedVersion;
  }

  getVersion(): number {
    return this.version;
  }

  snapshot(): WalletState | null {
    return this.state ? { ...this.state } : null;
  }

  private ensureInitialized(): void {
    if (!this.state) {
      throw new Error('Wallet aggregate has not been initialized.');
    }
  }

  private ensureValidAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new InvalidAmountError(amount);
    }
  }

  private applyNewEvent(event: WalletDomainEvent): void {
    this.pendingEvents.push(event);
    this.version += 1;
    this.applyEvent(event);
    this.updateStateVersion();
  }

  private applyHistoricalEvent(event: StoredWalletEvent): void {
    this.applyEvent(event);
    this.version = event.metadata.version;
    this.persistedVersion = event.metadata.version;
    this.updateStateVersion();
  }

  private applyEvent(event: WalletDomainEvent | StoredWalletEvent): void {
    switch (event.type) {
      case 'WalletCreated': {
        const timestamp = this.getEventTimestamp(event);
        this.state = {
          id: this.id,
          ownerId: event.data.ownerId,
          balance: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: this.version,
        };
        break;
      }
      case 'WalletCredited': {
        this.ensureInitialized();
        const amount = event.data.amount;
        const balance = (this.state?.balance ?? 0) + amount;
        this.state = this.state
          ? {
              ...this.state,
              balance,
              updatedAt: this.getEventTimestamp(event),
              version: this.version,
            }
          : null;
        break;
      }
      case 'WalletDebited': {
        this.ensureInitialized();
        const amount = event.data.amount;
        const balance = (this.state?.balance ?? 0) - amount;
        this.state = this.state
          ? {
              ...this.state,
              balance,
              updatedAt: this.getEventTimestamp(event),
              version: this.version,
            }
          : null;
        break;
      }
      default:
        throw new Error('Unsupported wallet event');
    }
  }

  private clearPendingEvents(): void {
    this.pendingEvents.length = 0;
  }

  private getEventTimestamp(
    event: WalletDomainEvent | StoredWalletEvent,
  ): string {
    if ('metadata' in event && event.metadata?.occurredAt) {
      return event.metadata.occurredAt;
    }
    return new Date().toISOString();
  }

  private updateStateVersion(): void {
    if (this.state) {
      this.state = { ...this.state, version: this.version };
    }
  }
}
