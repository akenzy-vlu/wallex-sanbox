import { Test, TestingModule } from '@nestjs/testing';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { WalletModule } from './wallet.module';
import { CreateWalletCommand } from './application/commands/create-wallet.command';
import { CreditWalletCommand } from './application/commands/credit-wallet.command';
import { DebitWalletCommand } from './application/commands/debit-wallet.command';
import { GetWalletQuery } from './application/queries/get-wallet.query';
import { GetWalletsQuery } from './application/queries/get-wallets.query';
import { InsufficientFundsError } from './domain/errors';
import { EventStoreDbService } from './infrastructure/event-store/event-store.service';
import { StoredWalletEvent, WalletDomainEvent } from './domain/events';
import { EventConcurrencyError } from './domain/errors';
import {
  InMemoryWalletReadRepository,
  WalletReadRepository,
} from './infrastructure/read-model/wallet-read.repository';

class InMemoryEventStoreDbService {
  private readonly streams = new Map<string, StoredWalletEvent[]>();

  async readStream(aggregateId: string): Promise<StoredWalletEvent[]> {
    return [...(this.streams.get(aggregateId) ?? [])];
  }

  async appendToStream(
    aggregateId: string,
    events: WalletDomainEvent[],
    expectedVersion: number,
  ): Promise<StoredWalletEvent[]> {
    const stream = this.streams.get(aggregateId) ?? [];
    const currentVersion = stream.length
      ? stream[stream.length - 1].metadata.version
      : -1;

    if (currentVersion !== expectedVersion) {
      throw new EventConcurrencyError(expectedVersion, currentVersion);
    }

    const committedEvents = events.map((event, index) => ({
      type: event.type,
      aggregateId,
      data: event.data,
      metadata: {
        version: currentVersion + index + 1,
        occurredAt: new Date().toISOString(),
      },
    })) as unknown as StoredWalletEvent[];

    stream.push(...committedEvents);
    this.streams.set(aggregateId, stream);
    return committedEvents;
  }
}

describe('WalletModule flow', () => {
  let moduleRef: TestingModule;
  let commandBus: CommandBus;
  let queryBus: QueryBus;

  beforeEach(async () => {
    const readRepository = new InMemoryWalletReadRepository();

    moduleRef = await Test.createTestingModule({
      imports: [WalletModule],
    })
      .overrideProvider(EventStoreDbService)
      .useValue(new InMemoryEventStoreDbService())
      .overrideProvider(WalletReadRepository)
      .useValue(readRepository)
      .compile();

    await moduleRef.init();
    commandBus = moduleRef.get(CommandBus);
    queryBus = moduleRef.get(QueryBus);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('executes command to query flow with projections', async () => {
    await commandBus.execute(
      new CreateWalletCommand('wallet-1', 'owner-1', 100),
    );
    await commandBus.execute(
      new CreditWalletCommand('wallet-1', 50, 'bonus deposit'),
    );
    await commandBus.execute(
      new DebitWalletCommand('wallet-1', 20, 'purchase'),
    );

    const wallet = await queryBus.execute(new GetWalletQuery('wallet-1'));

    expect(wallet).toBeDefined();
    expect(wallet?.balance).toBe(130);
    expect(wallet?.version).toBe(3);
    expect(wallet?.auditTrail).toHaveLength(4);
    expect(wallet?.auditTrail.at(-1)?.description).toBe('purchase');

    const wallets = await queryBus.execute(new GetWalletsQuery());
    expect(wallets).toHaveLength(1);
    expect(wallets[0]?.id).toBe('wallet-1');
  });

  it('guards against overdrafts via domain enforcement', async () => {
    await commandBus.execute(
      new CreateWalletCommand('wallet-2', 'owner-2', 40),
    );

    await expect(
      commandBus.execute(new DebitWalletCommand('wallet-2', 50, 'overspend')),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it('returns all wallets via query', async () => {
    await commandBus.execute(
      new CreateWalletCommand('wallet-a', 'owner-a', 25),
    );
    await commandBus.execute(
      new CreateWalletCommand('wallet-b', 'owner-b', 35),
    );

    const wallets = await queryBus.execute(new GetWalletsQuery());

    expect(wallets).toHaveLength(2);
    expect(wallets.map((wallet) => wallet.id).sort()).toEqual([
      'wallet-a',
      'wallet-b',
    ]);
  });
});
