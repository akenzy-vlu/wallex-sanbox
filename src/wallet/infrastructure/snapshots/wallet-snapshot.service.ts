import { Injectable } from '@nestjs/common';
import { WalletAggregate } from '../../domain/wallet.aggregate';
import { EventStoreDbService } from '../event-store/event-store.service';
import {
  WalletSnapshotRepository,
  WalletSnapshot,
} from './wallet-snapshot.repository';
import { StoredWalletEvent } from '../../domain/events';

export interface SnapshotConfig {
  snapshotThreshold: number; // Create snapshot every N events
  keepLastSnapshots: number; // Number of old snapshots to keep
}

const DEFAULT_CONFIG: SnapshotConfig = {
  snapshotThreshold: 100,
  keepLastSnapshots: 3,
};

@Injectable()
export class WalletSnapshotService {
  private readonly config: SnapshotConfig;

  constructor(
    private readonly snapshotRepository: WalletSnapshotRepository,
    private readonly eventStore: EventStoreDbService,
  ) {
    this.config = {
      snapshotThreshold:
        parseInt(process.env.SNAPSHOT_THRESHOLD || '') ||
        DEFAULT_CONFIG.snapshotThreshold,
      keepLastSnapshots:
        parseInt(process.env.SNAPSHOT_KEEP_LAST || '') ||
        DEFAULT_CONFIG.keepLastSnapshots,
    };

    console.log('Snapshot service initialized with config:', this.config);
  }

  /**
   * Load aggregate with snapshot optimization
   * Returns the aggregate and event count for snapshot decision
   */
  async loadAggregate(
    walletId: string,
  ): Promise<{ aggregate: WalletAggregate; eventCount: number } | null> {
    // Try to load latest snapshot
    const snapshot = await this.snapshotRepository.getLatestSnapshot(walletId);

    let events: StoredWalletEvent[];
    let aggregate: WalletAggregate;

    if (snapshot) {
      // Load events after the snapshot
      console.log(
        `Loading wallet ${walletId} from snapshot version ${snapshot.version}`,
      );
      events = await this.eventStore.readStreamFromVersion(
        walletId,
        snapshot.version + 1,
      );

      // Rehydrate from snapshot + events
      aggregate = WalletAggregate.rehydrateFromSnapshot(
        walletId,
        snapshot.state,
        snapshot.version,
        events,
      );

      console.log(
        `Loaded ${events.length} events after snapshot for wallet ${walletId}`,
      );
    } else {
      // No snapshot, load all events
      events = await this.eventStore.readStream(walletId);
      if (events.length === 0) {
        return null;
      }

      aggregate = WalletAggregate.rehydrate(walletId, events);
      console.log(`Loaded ${events.length} events for wallet ${walletId}`);
    }

    // Return total event count (snapshot version + new events)
    const totalEventCount = snapshot
      ? snapshot.version + 1 + events.length
      : events.length;

    return { aggregate, eventCount: totalEventCount };
  }

  /**
   * Create a snapshot if conditions are met
   */
  async createSnapshotIfNeeded(
    aggregate: WalletAggregate,
    eventCount: number,
  ): Promise<void> {
    // Check if we need to create a snapshot
    if (!this.shouldCreateSnapshot(eventCount)) {
      return;
    }

    const state = aggregate.snapshot();
    if (!state) {
      return;
    }

    const walletId = state.id;
    const currentVersion = aggregate.getVersion();

    // Get current snapshot version
    const latestSnapshot =
      await this.snapshotRepository.getLatestSnapshot(walletId);
    const snapshotVersion = latestSnapshot
      ? latestSnapshot.snapshotVersion + 1
      : 1;

    // Create new snapshot
    const snapshot: WalletSnapshot = {
      aggregateId: walletId,
      state,
      version: currentVersion,
      snapshotVersion,
      timestamp: new Date().toISOString(),
    };

    await this.snapshotRepository.saveSnapshot(snapshot);

    console.log(
      `Created snapshot v${snapshotVersion} for wallet ${walletId} at event version ${currentVersion}`,
    );

    // Cleanup old snapshots asynchronously
    this.snapshotRepository
      .deleteOldSnapshots(walletId, this.config.keepLastSnapshots)
      .catch((error) => {
        console.error('Error cleaning up old snapshots:', error);
      });
  }

  /**
   * Force create a snapshot for a wallet
   */
  async createSnapshot(walletId: string): Promise<void> {
    const result = await this.loadAggregate(walletId);
    if (!result) {
      throw new Error(`Wallet ${walletId} not found`);
    }

    const { aggregate } = result;
    const state = aggregate.snapshot();
    if (!state) {
      throw new Error(`Cannot snapshot wallet ${walletId}`);
    }

    const currentVersion = aggregate.getVersion();
    const latestSnapshot =
      await this.snapshotRepository.getLatestSnapshot(walletId);
    const snapshotVersion = latestSnapshot
      ? latestSnapshot.snapshotVersion + 1
      : 1;

    const snapshot: WalletSnapshot = {
      aggregateId: walletId,
      state,
      version: currentVersion,
      snapshotVersion,
      timestamp: new Date().toISOString(),
    };

    await this.snapshotRepository.saveSnapshot(snapshot);
    console.log(
      `Force created snapshot v${snapshotVersion} for wallet ${walletId}`,
    );
  }

  private shouldCreateSnapshot(eventCount: number): boolean {
    // Create snapshot if event count exceeds threshold
    // and it's a multiple of the threshold (to avoid creating too many)
    return (
      eventCount >= this.config.snapshotThreshold &&
      eventCount % this.config.snapshotThreshold === 0
    );
  }

  getConfig(): SnapshotConfig {
    return { ...this.config };
  }
}
