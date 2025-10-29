import { Controller, Get, Logger } from '@nestjs/common';
import { UserService } from '../../application/user.service';

/**
 * UserController
 *
 * REST API endpoints for user operations
 */
@Controller('users')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly userService: UserService) {}

  @Get('health')
  health(): { status: string; module: string } {
    return { status: 'ok', module: 'user' };
  }
}
