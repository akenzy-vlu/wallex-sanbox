import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Kafka,
  Producer,
  ProducerRecord,
  RecordMetadata,
  CompressionTypes,
} from 'kafkajs';
import { DebugCaptureService } from '../integration/application/debug-capture.service';

export interface KafkaMessage {
  key?: string;
  value: string;
  headers?: Record<string, string>;
  partition?: number;
  timestamp?: string;
}

export interface PublishOptions {
  topic: string;
  messages: KafkaMessage[];
  acks?: number;
  timeout?: number;
  compression?: CompressionTypes;
}

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private kafka: Kafka;
  private producer: Producer;
  private isConnected = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly debugCapture: DebugCaptureService,
  ) {
    const brokers = this.configService
      .get<string>('KAFKA_BROKERS', 'localhost:29092')
      .split(',');
    const clientId = this.configService.get<string>(
      'KAFKA_CLIENT_ID',
      'wallex-producer',
    );

    this.kafka = new Kafka({
      clientId,
      brokers,
      retry: {
        initialRetryTime: 300,
        retries: 8,
        maxRetryTime: 30000,
        multiplier: 2,
        factor: 0.2,
      },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 60000,
      idempotent: true, // Enable exactly-once semantics
      maxInFlightRequests: 5,
      retry: {
        initialRetryTime: 300,
        retries: 8,
        maxRetryTime: 30000,
        multiplier: 2,
      },
    });
  }

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  /**
   * Connect to Kafka
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      await this.producer.connect();
      this.isConnected = true;
      this.logger.log('Kafka producer connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect Kafka producer', error);
      throw error;
    }
  }

  /**
   * Disconnect from Kafka
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.producer.disconnect();
      this.isConnected = false;
      this.logger.log('Kafka producer disconnected');
    } catch (error) {
      this.logger.error('Failed to disconnect Kafka producer', error);
    }
  }

  /**
   * Publish messages to Kafka topic
   * @param options Publish options with topic and messages
   * @returns Array of record metadata
   */
  async publish(options: PublishOptions): Promise<RecordMetadata[]> {
    if (!this.isConnected) {
      throw new Error('Kafka producer is not connected');
    }

    const {
      topic,
      messages,
      acks = -1,
      timeout = 30000,
      compression = CompressionTypes.GZIP,
    } = options;

    try {
      const record: ProducerRecord = {
        topic,
        messages,
        acks,
        timeout,
        compression,
      };

      const result = await this.producer.send(record);

      this.logger.debug(
        `Published ${messages.length} messages to topic ${topic}, partitions: ${result.map((r) => r.partition).join(', ')}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to publish to topic ${topic}: ${error.message}`,
        error.stack,
      );
      // Capture debug context for troubleshooting
      await this.debugCapture.writeCapture({
        source: 'kafka-producer',
        type: 'publish_error',
        error: { message: error.message, stack: error.stack },
        payload: { topic, messages },
      });
      throw error;
    }
  }

  /**
   * Publish a single message to Kafka topic
   * @param topic Topic name
   * @param message Message to publish
   * @returns Record metadata
   */
  async publishOne(
    topic: string,
    message: KafkaMessage,
  ): Promise<RecordMetadata[]> {
    return this.publish({ topic, messages: [message] });
  }

  /**
   * Publish messages in a transaction (exactly-once semantics)
   * @param transactions Array of publish operations
   */
  async publishTransaction(transactions: PublishOptions[]): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Kafka producer is not connected');
    }

    const transaction = await this.producer.transaction();

    try {
      for (const tx of transactions) {
        await transaction.send({
          topic: tx.topic,
          messages: tx.messages,
          acks: tx.acks ?? -1,
          timeout: tx.timeout ?? 30000,
          compression: tx.compression ?? CompressionTypes.GZIP,
        });
      }

      await transaction.commit();
      this.logger.debug(
        `Transaction committed with ${transactions.length} operations`,
      );
    } catch (error) {
      await transaction.abort();
      this.logger.error(`Transaction aborted: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get producer instance for advanced usage
   */
  getProducer(): Producer {
    return this.producer;
  }

  /**
   * Check if producer is connected
   */
  isProducerConnected(): boolean {
    return this.isConnected;
  }
}
