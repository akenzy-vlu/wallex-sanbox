import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class DistributedLockService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  onModuleInit() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.client.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis connected successfully');
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  /**
   * Acquire a distributed lock
   * @param key The lock key (e.g., 'lock:wallet:walletId')
   * @param ttlMs Time-to-live in milliseconds (lock expiration)
   * @returns Lock token if acquired, null if failed
   */
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const lockToken = this.generateLockToken();

    // SET key value PX milliseconds NX
    // NX - Only set if key does not exist
    // PX - Set expiry time in milliseconds
    const result = await this.client.set(key, lockToken, 'PX', ttlMs, 'NX');

    return result === 'OK' ? lockToken : null;
  }

  /**
   * Release a distributed lock
   * @param key The lock key
   * @param token The lock token (to ensure we only release our own lock)
   */
  async release(key: string, token: string): Promise<boolean> {
    // Lua script to atomically check token and delete
    // This ensures we only delete our own lock
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.client.eval(script, 1, key, token);
    return result === 1;
  }

  /**
   * Acquire lock with retry mechanism using exponential backoff
   * @param key The lock key
   * @param ttlMs Time-to-live in milliseconds
   * @param maxRetries Maximum number of retry attempts
   * @param initialRetryDelayMs Initial delay between retries in milliseconds
   */
  async acquireWithRetry(
    key: string,
    ttlMs: number,
    maxRetries: number = 100,
    initialRetryDelayMs: number = 10,
  ): Promise<string> {
    let attempt = 0;

    while (attempt < maxRetries) {
      const token = await this.acquire(key, ttlMs);

      if (token) {
        return token;
      }

      // Exponential backoff with jitter
      // Formula: min(initialDelay * 2^attempt, 500ms) + random jitter
      const exponentialDelay = Math.min(
        initialRetryDelayMs * Math.pow(1.5, attempt),
        500,
      );

      // Add jitter: random value between 0 and exponentialDelay/2
      const jitter = Math.random() * (exponentialDelay / 2);
      const delayMs = Math.floor(exponentialDelay + jitter);

      // Wait before retrying
      await this.sleep(delayMs);
      attempt++;
    }

    throw new Error(
      `Failed to acquire lock for ${key} after ${maxRetries} attempts`,
    );
  }

  /**
   * Execute a function with lock protection
   * @param key The lock key
   * @param ttlMs Time-to-live in milliseconds
   * @param handler The function to execute
   * @param maxRetries Maximum number of retry attempts (default 100)
   */
  async withLock<T>(
    key: string,
    ttlMs: number,
    handler: () => Promise<T>,
    maxRetries: number = 100,
  ): Promise<T> {
    const token = await this.acquireWithRetry(key, ttlMs, maxRetries);

    try {
      return await handler();
    } finally {
      await this.release(key, token);
    }
  }

  private generateLockToken(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
