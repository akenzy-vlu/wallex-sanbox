import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { IntegrationService } from './application/integration.service';
import { IntegrationController } from './interfaces/rest/integration.controller';

/**
 * IntegrationModule
 *
 * Responsible for:
 * - External API integrations
 * - Webhook handlers
 * - Third-party service connectors
 * - API gateway patterns
 *
 * Provider boundaries:
 * - Application layer: Integration orchestration
 * - Domain layer: Integration contracts and DTOs
 * - Infrastructure layer: HTTP clients, adapters
 * - Interface layer: Webhook endpoints, REST API
 */
@Module({
  imports: [CqrsModule],
  controllers: [IntegrationController],
  providers: [IntegrationService],
  exports: [IntegrationService],
})
export class IntegrationModule {}
