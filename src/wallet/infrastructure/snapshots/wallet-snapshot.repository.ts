import { Inject, Injectable } from '@nestjs/common';
import {
  KurrentDBClient,
  jsonEvent,
  StreamNotFoundError,
  BACKWARDS,
  END,
} from '@kurrent/kurrentdb-client';
import { randomUUID } from 'crypto';
import { KURRENTDB_CONNECTION } from '../event-store/kurrentdb.tokens';

export interface WalletSnapshot {
  aggregateId: string;
  state: {
    id: string;
    ownerId: string;
    balance: number;
    createdAt: string;
    updatedAt: string;
    version: number;
  };
  version: number; // Last event version included in this snapshot
  snapshotVersion: number; // Incremental snapshot version
  timestamp: string;
}

@Injectable()
export class WalletSnapshotRepository {
  constructor(
    @Inject(KURRENTDB_CONNECTION)
    private readonly client: KurrentDBClient,
  ) {}

  /**
   * Get the snapshot stream name for a wallet
   */
  private snapshotStreamName(aggregateId: string): string {
    return `snapshot-wallet-${aggregateId}`;
  }

  /**
   * Save a snapshot to KurrentDB
   * Stored in separate stream: snapshot-wallet-{aggregateId}
   */
  async saveSnapshot(snapshot: WalletSnapshot): Promise<void> {
    try {
      const streamName = this.snapshotStreamName(snapshot.aggregateId);

      const event = jsonEvent({
        id: randomUUID(),
        type: 'WalletSnapshot',
        data: snapshot as any, // Cast to any for KurrentDB client compatibility
        metadata: {
          snapshottedStreamRevision: snapshot.version,
          timestamp: snapshot.timestamp,
        },
      });

      // Append snapshot to stream
      await this.client.appendToStream(streamName, [event]);

      // Set stream metadata to keep only last N snapshots
      // $maxCount will automatically delete old events
      await this.setStreamMaxCount(
        streamName,
        parseInt(process.env.SNAPSHOT_KEEP_LAST || '3'),
      );

      console.log(
        `Saved snapshot v${snapshot.snapshotVersion} for wallet ${snapshot.aggregateId} to stream ${streamName}`,
      );
    } catch (error) {
      console.error('Error saving snapshot to KurrentDB:', error);
      throw error;
    }
  }

  /**
   * Get the latest snapshot from KurrentDB
   * Reads backwards from the end of the snapshot stream
   */
  async getLatestSnapshot(aggregateId: string): Promise<WalletSnapshot | null> {
    try {
      const streamName = this.snapshotStreamName(aggregateId);

      // Read the last event from the snapshot stream
      const events = this.client.readStream(streamName, {
        direction: BACKWARDS,
        fromRevision: END,
        maxCount: 1,
      });

      // Get the first (and only) event
      for await (const resolvedEvent of events) {
        const event = resolvedEvent.event;
        if (event && event.type === 'WalletSnapshot') {
          return event.data as unknown as WalletSnapshot;
        }
      }

      return null; // No snapshot found
    } catch (error) {
      if (error instanceof StreamNotFoundError) {
        // No snapshots exist yet for this wallet
        return null;
      }
      console.error('Error getting latest snapshot from KurrentDB:', error);
      throw error;
    }
  }

  /**
   * Set the $maxCount metadata on snapshot stream
   * This automatically keeps only the last N snapshots
   */
  private async setStreamMaxCount(
    streamName: string,
    maxCount: number,
  ): Promise<void> {
    try {
      await this.client.setStreamMetadata(streamName, {
        maxCount,
      });
    } catch (error) {
      // Non-critical - log but don't throw
      console.warn(
        `Could not set $maxCount on stream ${streamName}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Legacy method - no longer needed with $maxCount
   * KurrentDB automatically deletes old snapshots
   * @param aggregateId - The wallet aggregate ID
   * @param _keepLastN - (Unused) Kept for API compatibility
   */
  async deleteOldSnapshots(
    aggregateId: string,
    _keepLastN?: number,
  ): Promise<void> {
    // No-op: $maxCount handles this automatically
    console.log(
      `Snapshot cleanup handled automatically by KurrentDB $maxCount for wallet ${aggregateId}`,
    );
  }
}
