import { Controller, Get } from '@nestjs/common';
import { KafkaProducerService } from './kafka-producer.service';

@Controller('health/kafka')
export class KafkaHealthController {
  constructor(private readonly kafkaProducer: KafkaProducerService) {}

  @Get()
  async checkHealth() {
    const isProducerConnected = this.kafkaProducer.isProducerConnected();

    return {
      status: isProducerConnected ? 'healthy' : 'unhealthy',
      producer: {
        connected: isProducerConnected,
      },
      kafka: {
        status: isProducerConnected ? 'connected' : 'disconnected',
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('stats')
  async getStats() {
    return {
      producer: {
        connected: this.kafkaProducer.isProducerConnected(),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
