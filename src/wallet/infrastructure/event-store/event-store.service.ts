import { Inject, Injectable } from '@nestjs/common';
import {
  EventData,
  FORWARDS,
  KurrentDBClient,
  NO_STREAM,
  START,
  StreamNotFoundError,
  WrongExpectedVersionError,
  jsonEvent,
} from '@kurrent/kurrentdb-client';
import { randomUUID } from 'crypto';
import { EventConcurrencyError } from '../../domain/errors';
import {
  StoredWalletEvent,
  WalletCreatedEvent,
  WalletDomainEvent,
  WalletCreditedEvent,
  WalletDebitedEvent,
  WalletEventType,
} from '../../domain/events';
import { KURRENTDB_CONNECTION } from './kurrentdb.tokens';

interface SerializedEvent {
  readonly domain: WalletDomainEvent;
  readonly occurredAt: string;
  readonly payload: EventData;
}

@Injectable()
export class EventStoreDbService {
  constructor(
    @Inject(KURRENTDB_CONNECTION)
    private readonly client: KurrentDBClient,
  ) {}

  async readStream(aggregateId: string): Promise<StoredWalletEvent[]> {
    return this.readStreamFromVersion(aggregateId, 0);
  }

  async readStreamFromVersion(
    aggregateId: string,
    fromVersion: number,
  ): Promise<StoredWalletEvent[]> {
    const events: StoredWalletEvent[] = [];
    const streamName = this.streamName(aggregateId);

    try {
      const fromRevision = fromVersion === 0 ? START : BigInt(fromVersion);
      const resolvedEvents = this.client.readStream(streamName, {
        direction: FORWARDS,
        fromRevision,
      });

      for await (const resolved of resolvedEvents) {
        const recorded = resolved.event;
        if (!recorded || !this.isWalletEventType(recorded.type)) {
          continue;
        }

        const metadata = this.normalizeMetadata(recorded.metadata);
        const baseMetadata = {
          version: Number(recorded.revision),
          occurredAt: metadata.occurredAt ?? recorded.created.toISOString(),
          correlationId: metadata.correlationId,
          causationId: metadata.causationId,
        } as StoredWalletEvent['metadata'];

        switch (recorded.type) {
          case 'WalletCreated':
            events.push({
              type: recorded.type,
              aggregateId,
              data: recorded.data as WalletCreatedEvent['data'],
              metadata: baseMetadata,
            });
            break;
          case 'WalletCredited':
            events.push({
              type: recorded.type,
              aggregateId,
              data: recorded.data as WalletCreditedEvent['data'],
              metadata: baseMetadata,
            });
            break;
          case 'WalletDebited':
            events.push({
              type: recorded.type,
              aggregateId,
              data: recorded.data as WalletDebitedEvent['data'],
              metadata: baseMetadata,
            });
            break;
        }
      }
    } catch (error) {
      if (!(error instanceof StreamNotFoundError)) {
        throw error;
      }
    }

    return events;
  }

  async appendToStream(
    aggregateId: string,
    events: WalletDomainEvent[],
    expectedVersion: number,
  ): Promise<StoredWalletEvent[]> {
    if (events.length === 0) {
      return [];
    }

    const streamName = this.streamName(aggregateId);
    const serializedEvents = events.map((event) => this.serializeEvent(event));
    const streamState =
      expectedVersion < 0 ? NO_STREAM : BigInt(expectedVersion);

    try {
      const result = await this.client.appendToStream(
        streamName,
        serializedEvents.map((entry) => entry.payload),
        { streamState },
      );

      const lastRevision = result.nextExpectedRevision;
      const firstRevision = lastRevision - BigInt(events.length - 1);

      return serializedEvents.map((entry, index) => {
        const revision = firstRevision + BigInt(index);
        return {
          type: entry.domain.type,
          aggregateId,
          data: entry.domain.data,
          metadata: {
            version: Number(revision),
            occurredAt: entry.occurredAt,
          },
        } as StoredWalletEvent;
      });
    } catch (error) {
      if (error instanceof WrongExpectedVersionError) {
        const actualVersion =
          typeof error.actualState === 'bigint'
            ? Number(error.actualState)
            : -1;
        throw new EventConcurrencyError(expectedVersion, actualVersion);
      }
      throw error;
    }
  }

  private serializeEvent(event: WalletDomainEvent): SerializedEvent {
    const occurredAt = new Date().toISOString();
    return {
      domain: event,
      occurredAt,
      payload: jsonEvent({
        id: randomUUID(),
        type: event.type,
        data: event.data,
        metadata: { occurredAt },
      }),
    };
  }

  private streamName(aggregateId: string): string {
    return `wallet-${aggregateId}`;
  }

  private isWalletEventType(type: string): type is WalletEventType {
    return (
      type === 'WalletCreated' ||
      type === 'WalletCredited' ||
      type === 'WalletDebited'
    );
  }

  private normalizeMetadata(
    metadata: unknown,
  ): Partial<Record<'occurredAt' | 'correlationId' | 'causationId', string>> {
    if (metadata && typeof metadata === 'object') {
      const candidate = metadata as Record<string, unknown>;
      return {
        occurredAt:
          typeof candidate.occurredAt === 'string'
            ? candidate.occurredAt
            : undefined,
        correlationId:
          typeof candidate.correlationId === 'string'
            ? candidate.correlationId
            : undefined,
        causationId:
          typeof candidate.causationId === 'string'
            ? candidate.causationId
            : undefined,
      };
    }

    return {};
  }
}
