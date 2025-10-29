import { Controller, Get, Logger } from '@nestjs/common';
import { IntegrationService } from '../../application/integration.service';

/**
 * IntegrationController
 *
 * REST API endpoints for integration operations
 */
@Controller('integration')
export class IntegrationController {
  private readonly logger = new Logger(IntegrationController.name);

  constructor(private readonly integrationService: IntegrationService) {}

  @Get('health')
  health(): { status: string; module: string } {
    return { status: 'ok', module: 'integration' };
  }
}
