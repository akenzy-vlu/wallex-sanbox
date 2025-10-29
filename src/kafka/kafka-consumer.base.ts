import { Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Kafka,
  Consumer,
  ConsumerConfig,
  EachMessagePayload,
  ConsumerSubscribeTopics,
  KafkaMessage,
} from 'kafkajs';
import { DebugCaptureService } from '../integration/application/debug-capture.service';

export interface KafkaConsumerConfig {
  groupId: string;
  topics: string[];
  fromBeginning?: boolean;
  autoCommit?: boolean;
  autoCommitInterval?: number;
  sessionTimeout?: number;
  heartbeatInterval?: number;
}

export interface MessageContext {
  topic: string;
  partition: number;
  message: KafkaMessage;
  heartbeat: () => Promise<void>;
  pause: () => void;
}

export abstract class BaseKafkaConsumer implements OnModuleInit, OnModuleDestroy {
  protected readonly logger: Logger;
  private kafka: Kafka;
  private consumer: Consumer;
  private isRunning = false;
  private consecutiveErrors = 0;
  private readonly maxRetries = 5;

  constructor(
    protected readonly config: KafkaConsumerConfig,
    protected readonly configService: ConfigService,
    private readonly debugCapture: DebugCaptureService,
  ) {
    this.logger = new Logger(config.groupId);

    const brokers = this.configService.get<string>('KAFKA_BROKERS', 'localhost:29092').split(',');
    const clientId = this.configService.get<string>('KAFKA_CLIENT_ID', 'wallex-consumer');

    this.kafka = new Kafka({
      clientId,
      brokers,
      retry: {
        initialRetryTime: 300,
        retries: 8,
        maxRetryTime: 30000,
        multiplier: 2,
      },
    });

    const consumerConfig: ConsumerConfig = {
      groupId: config.groupId,
      sessionTimeout: config.sessionTimeout ?? 30000,
      heartbeatInterval: config.heartbeatInterval ?? 3000,
      maxWaitTimeInMs: 5000,
      retry: {
        initialRetryTime: 300,
        retries: 5,
        maxRetryTime: 30000,
        multiplier: 2,
      },
    };

    this.consumer = this.kafka.consumer(consumerConfig);
  }

  async onModuleInit() {
    await this.start();
  }

  async onModuleDestroy() {
    await this.stop();
  }

  /**
   * Start the consumer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Consumer already running');
      return;
    }

    try {
      await this.consumer.connect();
      this.logger.log(`Connected to Kafka for group: ${this.config.groupId}`);

      const subscribeConfig: ConsumerSubscribeTopics = {
        topics: this.config.topics,
        fromBeginning: this.config.fromBeginning ?? false,
      };

      await this.consumer.subscribe(subscribeConfig);
      this.logger.log(`Subscribed to topics: ${this.config.topics.join(', ')}`);

      await this.consumer.run({
        autoCommit: this.config.autoCommit ?? true,
        autoCommitInterval: this.config.autoCommitInterval ?? 5000,
        eachMessage: async (payload: EachMessagePayload) => {
          await this.handleMessage(payload);
        },
      });

      this.isRunning = true;
      this.logger.log(`Consumer started for group: ${this.config.groupId}`);
    } catch (error) {
      this.logger.error(`Failed to start consumer: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Stop the consumer
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.consumer.disconnect();
      this.isRunning = false;
      this.logger.log(`Consumer stopped for group: ${this.config.groupId}`);
    } catch (error) {
      this.logger.error(`Failed to stop consumer: ${error.message}`, error.stack);
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message, heartbeat, pause } = payload;
    const startTime = Date.now();

    try {
      const context: MessageContext = {
        topic,
        partition,
        message,
        heartbeat,
        pause,
      };

      // Parse message value
      const value = message.value?.toString();
      if (!value) {
        this.logger.warn(`Received empty message on ${topic}:${partition}:${message.offset}`);
        return;
      }

      // Call abstract method implemented by subclass
      await this.processMessage(context, value);

      // Reset error counter on success
      this.consecutiveErrors = 0;

      const duration = Date.now() - startTime;
      this.logger.debug(
        `Processed message from ${topic}:${partition}:${message.offset} in ${duration}ms`,
      );

      // Emit metrics
      this.emitMetrics({
        topic,
        partition,
        offset: message.offset,
        durationMs: duration,
        success: true,
      });
    } catch (error) {
      this.consecutiveErrors++;
      this.logger.error(
        `Error processing message from ${topic}:${partition}:${message.offset} (attempt ${this.consecutiveErrors}/${this.maxRetries}): ${error.message}`,
        error.stack,
      );

      await this.debugCapture.writeCapture({
        source: 'kafka-consumer',
        type: 'consume_error',
        error: { message: error.message, stack: error.stack },
        payload: {
          topic,
          partition,
          offset: message.offset,
          key: message.key?.toString(),
          value: message.value?.toString(),
          headers: message.headers,
        },
        metadata: { groupId: this.config.groupId },
      });

      this.emitMetrics({
        topic,
        partition,
        offset: message.offset,
        durationMs: Date.now() - startTime,
        success: false,
        error: error.message,
      });

      // Handle retry logic
      if (this.consecutiveErrors >= this.maxRetries) {
        // Send to DLQ
        await this.sendToDLQ(topic, message, error);

        // Pause consumer for backoff
        pause();
        setTimeout(() => {
          this.consumer.resume([{ topic, partitions: [partition] }]);
        }, 10000);
      } else {
        // Exponential backoff
        await this.sleep(Math.pow(2, this.consecutiveErrors) * 1000);
      }

      throw error; // Re-throw to prevent auto-commit
    }
  }

  /**
   * Process a message (implemented by subclass)
   */
  protected abstract processMessage(context: MessageContext, value: string): Promise<void>;

  /**
   * Send failed message to Dead Letter Queue
   */
  private async sendToDLQ(topic: string, message: KafkaMessage, error: Error): Promise<void> {
    try {
      // DLQ topic name convention
      const dlqTopic = `${topic}-dlq`;

      // This should use a KafkaProducerService in real implementation
      // For now, we just log
      this.logger.error(
        `Message sent to DLQ: ${dlqTopic}, offset: ${message.offset}, error: ${error.message}`,
      );
    } catch (dlqError) {
      this.logger.error(`Failed to send message to DLQ: ${dlqError.message}`, dlqError.stack);
    }
  }

  /**
   * Emit metrics (override in subclass for actual implementation)
   */
  protected emitMetrics(metrics: {
    topic: string;
    partition: number;
    offset: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }): void {
    // Default: just log
    this.logger.debug(`Metrics: ${JSON.stringify(metrics)}`);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if consumer is running
   */
  isConsumerRunning(): boolean {
    return this.isRunning;
  }
}

