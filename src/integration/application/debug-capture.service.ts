import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';

@Injectable()
export class DebugCaptureService {
  private readonly logger = new Logger(DebugCaptureService.name);
  private readonly captureDir = path.resolve(process.cwd(), 'debug-captures');

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.captureDir, { recursive: true });
    } catch (err) {
      // Intentionally ignore EEXIST; log other errors
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        this.logger.error(`Failed to create capture directory: ${err}`);
      }
    }
  }

  async writeCapture(event: {
    source: string;
    type: string;
    error?: any;
    payload?: any;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      await this.ensureDir();
      const timestamp = new Date().toISOString();
      const file = path.join(this.captureDir, `${timestamp.split('T')[0]}.cap.jsonl`);
      const line = JSON.stringify({
        timestamp,
        ...event,
      });
      await fs.appendFile(file, line + '\n', 'utf8');
    } catch (err) {
      this.logger.error(`Failed to write debug capture: ${err}`);
    }
  }
}


