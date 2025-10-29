import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KafkaProducerService } from './kafka-producer.service';
import { KafkaAdminService } from './kafka-admin.service';
import { KafkaHealthController } from './kafka-health.controller';
import { IntegrationModule } from '../integration/integration.module';

@Global()
@Module({
  imports: [ConfigModule, IntegrationModule],
  controllers: [KafkaHealthController],
  providers: [KafkaProducerService, KafkaAdminService],
  exports: [KafkaProducerService, KafkaAdminService],
})
export class KafkaModule {}

