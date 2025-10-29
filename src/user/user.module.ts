import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { UserService } from './application/user.service';
import { UserController } from './interfaces/rest/user.controller';

/**
 * UserModule
 *
 * Responsible for:
 * - User account management
 * - Authentication and authorization
 * - User profile operations
 * - User preferences and settings
 *
 * Provider boundaries:
 * - Application layer: User business logic
 * - Domain layer: User entities and value objects
 * - Infrastructure layer: User repository, auth providers
 * - Interface layer: REST API controllers
 */
@Module({
  imports: [CqrsModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
