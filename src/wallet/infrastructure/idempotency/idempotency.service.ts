import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { IdempotencyKey, IdempotencyStatus } from './idempotency.entity';
import * as crypto from 'crypto';

export interface IdempotencyOptions {
  ttlHours?: number;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly defaultTtlHours = 24;

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly idempotencyRepo: Repository<IdempotencyKey>,
  ) {}

  /**
   * Try to get a cached response for an idempotency key
   * @param key Idempotency key
   * @param requestData Request data to verify hash
   * @returns Cached response or null
   */
  async tryGet<T = any>(
    key: string,
    requestData?: any,
  ): Promise<T | null> {
    if (!key) {
      return null;
    }

    const record = await this.idempotencyRepo.findOne({
      where: { key },
    });

    if (!record) {
      return null;
    }

    // Check if expired
    if (record.expiresAt < new Date()) {
      this.logger.debug(`Idempotency key ${key} has expired`);
      await this.idempotencyRepo.delete({ key });
      return null;
    }

    // Verify request hash if provided
    if (requestData) {
      const requestHash = this.hashRequest(requestData);
      if (record.requestHash !== requestHash) {
        this.logger.warn(
          `Idempotency key ${key} used with different request data`,
        );
        throw new ConflictException(
          'Idempotency key reused with different request',
        );
      }
    }

    // Only return completed responses
    if (record.status === IdempotencyStatus.COMPLETED) {
      this.logger.debug(`Idempotency key ${key} found - returning cached response`);
      return record.response as T;
    }

    // If pending, the request is being processed - this is a duplicate concurrent request
    if (record.status === IdempotencyStatus.PENDING) {
      this.logger.warn(
        `Idempotency key ${key} is pending - concurrent request detected`,
      );
      throw new ConflictException(
        'Request with this idempotency key is already being processed',
      );
    }

    // If failed, allow retry
    if (record.status === IdempotencyStatus.FAILED) {
      this.logger.debug(`Idempotency key ${key} was failed - allowing retry`);
      return null;
    }

    return null;
  }

  /**
   * Store a pending idempotency key to prevent concurrent requests
   * @param key Idempotency key
   * @param requestData Request data to hash
   * @param options TTL options
   */
  async storePending(
    key: string,
    requestData: any,
    options: IdempotencyOptions = {},
  ): Promise<void> {
    if (!key) {
      return;
    }

    const ttlHours = options.ttlHours || this.defaultTtlHours;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ttlHours);

    const requestHash = this.hashRequest(requestData);

    try {
      await this.idempotencyRepo.insert({
        key,
        requestHash,
        response: {},
        status: IdempotencyStatus.PENDING,
        expiresAt,
        createdAt: new Date(),
      });

      this.logger.debug(`Stored pending idempotency key ${key}`);
    } catch (error) {
      // Duplicate key error means concurrent request
      if (error.code === '23505') {
        throw new ConflictException(
          'Request with this idempotency key is already being processed',
        );
      }
      throw error;
    }
  }

  /**
   * Store a completed response for an idempotency key
   * @param key Idempotency key
   * @param response Response data
   * @param options TTL options
   */
  async store<T = any>(
    key: string,
    response: T,
    options: IdempotencyOptions = {},
  ): Promise<void> {
    if (!key) {
      return;
    }

    const ttlHours = options.ttlHours || this.defaultTtlHours;
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ttlHours);

    // Try to update existing pending record first
    const updateResult = await this.idempotencyRepo.update(
      { key, status: IdempotencyStatus.PENDING },
      {
        response: response as any,
        status: IdempotencyStatus.COMPLETED,
        expiresAt,
      },
    );

    if (updateResult.affected === 0) {
      // No pending record, insert new completed record
      // This can happen if storePending wasn't called (optional flow)
      try {
        await this.idempotencyRepo.insert({
          key,
          requestHash: '', // Not critical for completed records
          response: response as any,
          status: IdempotencyStatus.COMPLETED,
          expiresAt,
          createdAt: new Date(),
        });
      } catch (error) {
        // Ignore duplicate key errors on insert
        if (error.code !== '23505') {
          throw error;
        }
      }
    }

    this.logger.debug(`Stored completed response for idempotency key ${key}`);
  }

  /**
   * Mark an idempotency key as failed
   * @param key Idempotency key
   */
  async markFailed(key: string): Promise<void> {
    if (!key) {
      return;
    }

    await this.idempotencyRepo.update(
      { key },
      { status: IdempotencyStatus.FAILED },
    );

    this.logger.debug(`Marked idempotency key ${key} as failed`);
  }

  /**
   * Delete an idempotency key (for testing or manual cleanup)
   * @param key Idempotency key
   */
  async delete(key: string): Promise<void> {
    await this.idempotencyRepo.delete({ key });
  }

  /**
   * Cleanup expired idempotency keys
   * @returns Number of deleted records
   */
  async cleanup(): Promise<number> {
    const now = new Date();
    const result = await this.idempotencyRepo.delete({
      expiresAt: LessThan(now),
    });

    const deletedCount = result.affected || 0;
    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} expired idempotency keys`);
    }

    return deletedCount;
  }

  /**
   * Get statistics about idempotency keys
   */
  async getStats(): Promise<{
    total: number;
    pending: number;
    completed: number;
    failed: number;
  }> {
    const [total, pending, completed, failed] = await Promise.all([
      this.idempotencyRepo.count(),
      this.idempotencyRepo.count({
        where: { status: IdempotencyStatus.PENDING },
      }),
      this.idempotencyRepo.count({
        where: { status: IdempotencyStatus.COMPLETED },
      }),
      this.idempotencyRepo.count({
        where: { status: IdempotencyStatus.FAILED },
      }),
    ]);

    return { total, pending, completed, failed };
  }

  /**
   * Hash request data for comparison
   * @param data Request data
   * @returns SHA-256 hash
   */
  private hashRequest(data: any): string {
    const normalized = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }
}

