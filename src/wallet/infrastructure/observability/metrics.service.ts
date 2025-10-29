import { Injectable, Logger } from '@nestjs/common';

/**
 * Metrics service for observability
 * 
 * This is a basic implementation that logs metrics.
 * In production, integrate with:
 * - Prometheus (using @willsoto/nestjs-prometheus)
 * - Datadog (using dd-trace)
 * - AWS CloudWatch
 * - Custom metrics backend
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  /**
   * Record a histogram metric (e.g., latency)
   */
  histogram(
    name: string,
    value: number,
    tags?: Record<string, string>,
  ): void {
    this.logger.debug(
      `HISTOGRAM ${name}: ${value} ${this.formatTags(tags)}`,
    );

    // TODO: Integrate with Prometheus
    // this.prometheusHistogram(name).observe(tags, value);
  }

  /**
   * Increment a counter metric
   */
  increment(
    name: string,
    value: number = 1,
    tags?: Record<string, string>,
  ): void {
    this.logger.debug(
      `COUNTER ${name}: +${value} ${this.formatTags(tags)}`,
    );

    // TODO: Integrate with Prometheus
    // this.prometheusCounter(name).inc(tags, value);
  }

  /**
   * Set a gauge metric (current value)
   */
  gauge(
    name: string,
    value: number,
    tags?: Record<string, string>,
  ): void {
    this.logger.debug(
      `GAUGE ${name}: ${value} ${this.formatTags(tags)}`,
    );

    // TODO: Integrate with Prometheus
    // this.prometheusGauge(name).set(tags, value);
  }

  /**
   * Track operation duration
   */
  timing(
    name: string,
    durationMs: number,
    tags?: Record<string, string>,
  ): void {
    this.histogram(name, durationMs, tags);
  }

  /**
   * Helper to format tags for logging
   */
  private formatTags(tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) {
      return '';
    }

    return Object.entries(tags)
      .map(([key, value]) => `${key}:${value}`)
      .join(' ');
  }
}

/**
 * Decorator for automatic method timing
 * Usage: @Timed('operation_name')
 */
export function Timed(metricName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      const metricsService = (this as any).metricsService as MetricsService;

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;

        if (metricsService) {
          metricsService.timing(metricName, duration, { status: 'success' });
        }

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        if (metricsService) {
          metricsService.timing(metricName, duration, {
            status: 'error',
            error: error.constructor.name,
          });
        }

        throw error;
      }
    };

    return descriptor;
  };
}

