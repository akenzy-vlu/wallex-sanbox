import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ReadModelProjector } from './read-model.projector';
import { LedgerProjector } from './ledger.projector';

/**
 * Bootstrap service to start and stop projector workers
 * 
 * This service automatically starts projector workers when the module initializes
 * and gracefully shuts them down when the module is destroyed.
 * 
 * To disable auto-start, set environment variable: PROJECTORS_AUTO_START=false
 */
@Injectable()
export class ProjectorBootstrapService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectorBootstrapService.name);
  private readonly autoStart: boolean;

  constructor(
    private readonly readModelProjector: ReadModelProjector,
    private readonly ledgerProjector: LedgerProjector,
  ) {
    this.autoStart = process.env.PROJECTORS_AUTO_START !== 'false';
  }

  async onModuleInit(): Promise<void> {
    if (!this.autoStart) {
      this.logger.log('Projector auto-start disabled (PROJECTORS_AUTO_START=false)');
      return;
    }

    this.logger.log('Starting projector workers...');

    try {
      // Start projectors
      await Promise.all([
        this.readModelProjector.start(),
        this.ledgerProjector.start(),
      ]);

      this.logger.log('All projector workers started successfully');
    } catch (error) {
      this.logger.error('Failed to start projector workers', error);
      // Don't throw - allow app to start even if projectors fail
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Stopping projector workers...');

    try {
      await Promise.all([
        this.readModelProjector.stop(),
        this.ledgerProjector.stop(),
      ]);

      this.logger.log('All projector workers stopped');
    } catch (error) {
      this.logger.error('Error stopping projector workers', error);
    }
  }

  /**
   * Manually start all projectors (for CLI/admin use)
   */
  async startAll(): Promise<void> {
    await Promise.all([
      this.readModelProjector.start(),
      this.ledgerProjector.start(),
    ]);
  }

  /**
   * Manually stop all projectors (for CLI/admin use)
   */
  async stopAll(): Promise<void> {
    await Promise.all([
      this.readModelProjector.stop(),
      this.ledgerProjector.stop(),
    ]);
  }
}

