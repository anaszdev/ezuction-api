import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { AuctionSchedulerService } from './auction-scheduler.service';

@Processor('auction-tasks')
export class AuctionTasksProcessor extends WorkerHost {
  private readonly logger = new Logger(AuctionTasksProcessor.name);

  constructor(private readonly schedulerService: AuctionSchedulerService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const startTime = Date.now();

    const rawData = job.data || {};
    const auctionId = rawData.auctionId || rawData.id;

    if (!auctionId) {
      throw new Error(`Missing auctionId in job payload (Job ID: ${job.id})`);
    }

    try {
      switch (job.name) {
        case 'start-auction':
          await this.schedulerService.startAuction(auctionId);

          break;

        case 'end-auction':
          const result = await this.schedulerService.settleAuction(auctionId);

          break;

        default:
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;

      if (error.stack) {
        this.logger.error(` Stack Trace:\n${error.stack}`);
      }
      throw error;
    }
  }
}
