import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client, errors } from '@elastic/elasticsearch';

export const ELASTICSEARCH_CLIENT = Symbol('ELASTICSEARCH_CLIENT');
const DEFAULT_INDEX = 'wallet-read-models';
const DEFAULT_RESULT_SIZE = 1000;

export interface AuditTrailEntry {
  readonly type: string;
  readonly amount?: number;
  readonly description?: string;
  readonly occurredAt: string;
}

export interface WalletReadModel {
  readonly id: string;
  readonly ownerId: string;
  readonly balance: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly auditTrail: AuditTrailEntry[];
}

@Injectable()
export class WalletReadRepository {
  private readonly logger = new Logger(WalletReadRepository.name);
  private readonly indexName =
    process.env.ELASTICSEARCH_WALLET_INDEX ?? DEFAULT_INDEX;
  private indexInitialized = false;

  constructor(
    @Inject(ELASTICSEARCH_CLIENT)
    private readonly client: Client,
  ) {}

  async save(model: WalletReadModel): Promise<void> {
    await this.ensureIndex();

    await this.client.index({
      index: this.indexName,
      id: model.id,
      document: {
        ...model,
        auditTrail: model.auditTrail.map((entry) => ({ ...entry })),
      },
      refresh: 'wait_for',
    });
  }

  async findById(walletId: string): Promise<WalletReadModel | null> {
    await this.ensureIndex();

    try {
      const result = await this.client.get<WalletReadModel>({
        index: this.indexName,
        id: walletId,
      });

      return result._source ? this.clone(result._source) : null;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  async searchByOwner(ownerId: string): Promise<WalletReadModel[]> {
    await this.ensureIndex();

    const result = await this.client.search<WalletReadModel>({
      index: this.indexName,
      size: DEFAULT_RESULT_SIZE,
      query: {
        term: {
          ownerId,
        },
      },
    });

    return result.hits.hits
      .map((hit) => hit._source)
      .filter((source): source is WalletReadModel => Boolean(source))
      .map((source) => this.clone(source));
  }

  async findAll(): Promise<WalletReadModel[]> {
    await this.ensureIndex();

    const result = await this.client.search<WalletReadModel>({
      index: this.indexName,
      size: DEFAULT_RESULT_SIZE,
      query: {
        match_all: {},
      },
    });

    return result.hits.hits
      .map((hit) => hit._source)
      .filter((source): source is WalletReadModel => Boolean(source))
      .map((source) => this.clone(source));
  }

  private async ensureIndex(): Promise<void> {
    if (this.indexInitialized) {
      return;
    }

    const exists = await this.client.indices.exists({ index: this.indexName });

    if (!exists) {
      try {
        await this.client.indices.create({
          index: this.indexName,
          mappings: {
            properties: {
              id: { type: 'keyword' },
              ownerId: { type: 'keyword' },
              balance: { type: 'double' },
              createdAt: { type: 'date' },
              updatedAt: { type: 'date' },
              version: { type: 'integer' },
              auditTrail: {
                type: 'nested',
                properties: {
                  type: { type: 'keyword' },
                  amount: { type: 'double' },
                  description: { type: 'text' },
                  occurredAt: { type: 'date' },
                },
              },
            },
          },
        });

        this.logger.log(
          `Created Elasticsearch index ${this.indexName} for wallet read models`,
        );
      } catch (error) {
        if (!this.isResourceExistsError(error)) {
          throw error;
        }
      }
    }

    this.indexInitialized = true;
  }

  private clone(document: WalletReadModel): WalletReadModel {
    return {
      ...document,
      auditTrail: document.auditTrail.map((entry) => ({ ...entry })),
    };
  }

  private isNotFoundError(error: unknown): boolean {
    return error instanceof errors.ResponseError && error.statusCode === 404;
  }

  private isResourceExistsError(error: unknown): boolean {
    if (!(error instanceof errors.ResponseError) || error.statusCode !== 400) {
      return false;
    }

    const body = error.meta?.body as { error?: { type?: string } } | undefined;

    return body?.error?.type === 'resource_already_exists_exception';
  }
}

@Injectable()
export class InMemoryWalletReadRepository {
  private readonly documents = new Map<string, WalletReadModel>();

  async save(model: WalletReadModel): Promise<void> {
    this.documents.set(model.id, this.clone(model));
  }

  async findById(walletId: string): Promise<WalletReadModel | null> {
    const document = this.documents.get(walletId);
    return document ? this.clone(document) : null;
  }

  async searchByOwner(ownerId: string): Promise<WalletReadModel[]> {
    const results: WalletReadModel[] = [];

    for (const document of this.documents.values()) {
      if (document.ownerId === ownerId) {
        results.push(this.clone(document));
      }
    }

    return results;
  }

  async findAll(): Promise<WalletReadModel[]> {
    const results: WalletReadModel[] = [];

    for (const document of this.documents.values()) {
      results.push(this.clone(document));
    }

    return results;
  }

  private clone(document: WalletReadModel): WalletReadModel {
    return {
      ...document,
      auditTrail: document.auditTrail.map((entry) => ({ ...entry })),
    };
  }
}
