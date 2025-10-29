import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * Tracing service for distributed tracing
 *
 * This service manages correlation IDs and causation IDs for tracking
 * requests across services and async operations.
 *
 * In production, integrate with:
 * - OpenTelemetry
 * - Jaeger
 * - AWS X-Ray
 * - Datadog APM
 */
@Injectable()
export class TracingService {
  private readonly logger = new Logger(TracingService.name);

  /**
   * Generate a new correlation ID
   */
  generateCorrelationId(): string {
    return randomUUID();
  }

  /**
   * Create a trace context
   */
  createTraceContext(
    correlationId?: string,
    causationId?: string,
  ): TraceContext {
    return {
      correlationId: correlationId || this.generateCorrelationId(),
      causationId: causationId || null,
      spanId: randomUUID(),
      startTime: Date.now(),
    };
  }

  /**
   * Start a new span
   */
  startSpan(name: string, context: TraceContext): Span {
    const span: Span = {
      name,
      spanId: randomUUID(),
      parentSpanId: context.spanId,
      correlationId: context.correlationId,
      startTime: Date.now(),
      tags: {},
      logs: [],
    };

    this.logger.debug(
      `Started span: ${name} [${span.spanId}] parent=[${span.parentSpanId}]`,
    );

    return span;
  }

  /**
   * Finish a span and log duration
   */
  finishSpan(span: Span, tags?: Record<string, any>): void {
    const duration = Date.now() - span.startTime;

    span.endTime = Date.now();
    span.tags = { ...span.tags, ...tags };

    this.logger.debug(
      `Finished span: ${span.name} [${span.spanId}] duration=${duration}ms tags=${JSON.stringify(span.tags)}`,
    );

    // TODO: Send to tracing backend (OpenTelemetry, Jaeger, etc.)
  }

  /**
   * Add tags to a span
   */
  addTags(span: Span, tags: Record<string, any>): void {
    span.tags = { ...span.tags, ...tags };
  }

  /**
   * Log an event in a span
   */
  logEvent(span: Span, message: string, data?: any): void {
    span.logs.push({
      timestamp: Date.now(),
      message,
      data,
    });

    this.logger.debug(`Span event: ${span.name} [${span.spanId}] ${message}`);
  }

  /**
   * Extract trace context from headers
   */
  extractFromHeaders(headers: Record<string, any>): Partial<TraceContext> {
    return {
      correlationId: headers['x-correlation-id'] || headers['correlation-id'],
      causationId: headers['x-causation-id'] || headers['causation-id'],
    };
  }

  /**
   * Inject trace context into headers
   */
  injectIntoHeaders(
    context: TraceContext,
    headers: Record<string, any> = {},
  ): Record<string, any> {
    return {
      ...headers,
      'x-correlation-id': context.correlationId,
      'x-causation-id': context.causationId || context.spanId,
    };
  }
}

export interface TraceContext {
  correlationId: string;
  causationId: string | null;
  spanId: string;
  startTime: number;
}

export interface Span {
  name: string;
  spanId: string;
  parentSpanId?: string;
  correlationId: string;
  startTime: number;
  endTime?: number;
  tags: Record<string, any>;
  logs: Array<{
    timestamp: number;
    message: string;
    data?: any;
  }>;
}
