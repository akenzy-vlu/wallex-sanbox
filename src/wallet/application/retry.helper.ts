import { EventConcurrencyError } from '../domain/errors';

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 15,
  initialDelayMs: 1,
  maxDelayMs: 100,
  backoffMultiplier: 1.3,
};

/**
 * Retry helper for handling optimistic concurrency conflicts in event sourcing.
 * Implements exponential backoff with jitter.
 */
export async function retryOnConcurrencyError<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt <= finalConfig.maxRetries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Only retry on concurrency errors
      if (!(error instanceof EventConcurrencyError)) {
        throw error;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= finalConfig.maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = Math.min(
        finalConfig.initialDelayMs *
          Math.pow(finalConfig.backoffMultiplier, attempt),
        finalConfig.maxDelayMs,
      );

      // Add jitter: random value between 0 and exponentialDelay
      const jitter = Math.random() * exponentialDelay;
      const delayMs = Math.floor(exponentialDelay + jitter);

      // Wait before retrying
      await sleep(delayMs);

      attempt++;
    }
  }

  throw lastError || new Error('Retry failed with unknown error');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
