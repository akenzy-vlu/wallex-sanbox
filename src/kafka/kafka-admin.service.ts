import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Admin, ITopicConfig } from 'kafkajs';

@Injectable()
export class KafkaAdminService implements OnModuleInit {
  private readonly logger = new Logger(KafkaAdminService.name);
  private kafka: Kafka;
  private admin: Admin;

  constructor(private readonly configService: ConfigService) {
    const brokers = this.configService.get<string>('KAFKA_BROKERS', 'localhost:29092').split(',');
    const clientId = this.configService.get<string>('KAFKA_CLIENT_ID', 'wallex-admin');

    this.kafka = new Kafka({
      clientId,
      brokers,
      retry: {
        initialRetryTime: 300,
        retries: 5,
        maxRetryTime: 30000,
      },
    });

    this.admin = this.kafka.admin();
  }

  async onModuleInit() {
    await this.connect();
    await this.createTopics();
  }

  /**
   * Connect admin client
   */
  private async connect(): Promise<void> {
    try {
      await this.admin.connect();
      this.logger.log('Kafka admin connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect Kafka admin', error);
      throw error;
    }
  }

  /**
   * Create required topics if they don't exist
   */
  private async createTopics(): Promise<void> {
    const topics: ITopicConfig[] = [
      {
        topic: 'wallet-events',
        numPartitions: 10,
        replicationFactor: 1,
        configEntries: [
          { name: 'cleanup.policy', value: 'delete' },
          { name: 'retention.ms', value: '604800000' }, // 7 days
          { name: 'segment.ms', value: '86400000' }, // 1 day
          { name: 'compression.type', value: 'gzip' },
          { name: 'min.insync.replicas', value: '1' },
        ],
      },
      {
        topic: 'wallet-events-dlq',
        numPartitions: 5,
        replicationFactor: 1,
        configEntries: [
          { name: 'cleanup.policy', value: 'delete' },
          { name: 'retention.ms', value: '2592000000' }, // 30 days
          { name: 'compression.type', value: 'gzip' },
        ],
      },
    ];

    try {
      const existingTopics = await this.admin.listTopics();
      const topicsToCreate = topics.filter((t) => !existingTopics.includes(t.topic));

      if (topicsToCreate.length > 0) {
        await this.admin.createTopics({
          topics: topicsToCreate,
          waitForLeaders: true,
        });

        this.logger.log(
          `Created topics: ${topicsToCreate.map((t) => t.topic).join(', ')}`,
        );
      } else {
        this.logger.log('All required topics already exist');
      }
    } catch (error) {
      this.logger.error('Failed to create topics', error);
      throw error;
    }
  }

  /**
   * Disconnect admin client
   */
  async disconnect(): Promise<void> {
    try {
      await this.admin.disconnect();
      this.logger.log('Kafka admin disconnected');
    } catch (error) {
      this.logger.error('Failed to disconnect Kafka admin', error);
    }
  }

  /**
   * Get topic metadata
   */
  async getTopicMetadata(topics: string[]): Promise<any> {
    return this.admin.fetchTopicMetadata({ topics });
  }

  /**
   * List all consumer groups
   */
  async listGroups(): Promise<any> {
    return this.admin.listGroups();
  }

  /**
   * Delete a topic
   */
  async deleteTopic(topic: string): Promise<void> {
    await this.admin.deleteTopics({ topics: [topic] });
    this.logger.log(`Deleted topic: ${topic}`);
  }
}

