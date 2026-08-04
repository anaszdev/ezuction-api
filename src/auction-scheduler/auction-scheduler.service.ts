import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from '../database/database.service';
import { WalletService } from '../wallet/wallet.service';
import { RedisService } from '../redis/redis.service';
import { AuctionStatus } from '@prisma/client';
import { AuctionGateway } from '../auction/auction.gateway';

@Injectable()
export class AuctionSchedulerService {
  private readonly logger = new Logger(AuctionSchedulerService.name);

  constructor(
    @InjectQueue('auction-tasks') private readonly auctionQueue: Queue,
    private readonly prisma: DatabaseService,
    private readonly walletService: WalletService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => AuctionGateway))
    private readonly auctionGateway: AuctionGateway,
  ) {}
  //Brining auction counts by cach
  private async updateAuctionCounts(options: { isCompleted: boolean }) {
    const client = this.redisService.getClient();
    if (options.isCompleted) {
      const [rawActive, completedCount] = await Promise.all([
        client.decr('active_auctions_count'),
        client.incr('completed_auctions_count'),
      ]);
      const safeActive = Math.max(0, Number(rawActive));
      if (Number(rawActive) < 0) await client.set('active_auctions_count', 0);

      this.auctionGateway.sendAuctionCountsUpdate({
        upcoming: safeActive,
        completed: Number(completedCount),
      });
    } else {
      const rawActive = await client.decr('active_auctions_count');
      const safeActive = Math.max(0, Number(rawActive));
      if (Number(rawActive) < 0) await client.set('active_auctions_count', 0);

      this.auctionGateway.sendAuctionCountsUpdate({
        upcoming: safeActive,
      });
    }
  }

  //Handling Place and End Queue Using BullMq
  async scheduleAuctionJobs(auctionId: string, startAt: Date, endAt: Date) {
    const now = Date.now();
    const startTime = new Date(startAt).getTime();
    const endTime = new Date(endAt).getTime();

    const startDelay = Math.max(0, startTime - now);
    const endDelay = Math.max(0, endTime - now);

    await this.auctionQueue.add(
      'start-auction',
      { auctionId },
      {
        jobId: `start_${auctionId}`,
        delay: startDelay,
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    await this.auctionQueue.add(
      'end-auction',
      { auctionId },
      {
        jobId: `end_${auctionId}`,
        delay: endDelay,
        removeOnComplete: true,
        attempts: 5,
        backoff: { type: 'exponential', delay: 10000 },
      },
    );
  }

  async rescheduleAuctionEnd(auctionId: string, newEndAt: Date) {
    const jobId = `end_${auctionId}`;
    const now = Date.now();
    const targetTime = new Date(newEndAt).getTime();
    const newDelay = Math.max(0, targetTime - now);

    try {
      const existingJob = await this.auctionQueue.getJob(jobId);

      if (existingJob) {
        if (typeof existingJob.changeDelay === 'function') {
          await existingJob.changeDelay(newDelay);
        } else {
          await existingJob.remove();
          await this.auctionQueue.add(
            'end-auction',
            { auctionId },
            { jobId, delay: newDelay, removeOnComplete: true },
          );
        }
      } else {
        await this.auctionQueue.add(
          'end-auction',
          { auctionId },
          { jobId, delay: newDelay, removeOnComplete: true },
        );
      }
    } catch (error) {
      this.logger.error(`BullMQ Failed${auctionId}`, error);
    }
  }
  //Handling Canelling (Deleting) Auctions Queue Tasks from BullMq
  async cancelAuctionJobs(auctionId: string) {
    this.logger.warn(`Deleting Tasks From Auction ${auctionId}...`);

    const startJob = await this.auctionQueue.getJob(`start_${auctionId}`);
    const endJob = await this.auctionQueue.getJob(`end_${auctionId}`);

    if (startJob) await startJob.remove();
    if (endJob) await endJob.remove();
  }
  //Starting
  async startAuction(auctionId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const auctions = await tx.$queryRaw<any[]>`
        SELECT * FROM "Auction" WHERE "id" = ${auctionId} FOR UPDATE
      `;
      const auction = auctions[0];

      if (!auction) {
        this.logger.warn(`${auction} not exist`);
        return { action: 'SKIP' };
      }

      if (auction.status !== AuctionStatus.UPCOMING) {
        this.logger.warn(`${auction} status is not upcoming`);
        return { action: 'SKIP' };
      }

      const subscriptions = await tx.auctionSubscription.findMany({
        where: { auctionId },
      });

      if (subscriptions.length < auction.minParticipants) {
        await tx.auction.update({
          where: { id: auctionId },
          data: { status: AuctionStatus.CANCELED_INSUFFICIENT_BIDDERS },
        });

        for (const sub of subscriptions) {
          await this.walletService.unfreezeAmount(
            sub.userId,
            auction.depositRequired,
            tx,
          );
        }

        await this.walletService.unfreezeAmount(
          auction.sellerId,
          auction.sellerDepositFrozen,
          tx,
        );

        return {
          action: 'CANCEL',
          status: AuctionStatus.CANCELED_INSUFFICIENT_BIDDERS,
        };
      }

      await tx.auction.update({
        where: { id: auctionId },
        data: { status: AuctionStatus.LIVE },
      });

      return { action: 'START', status: AuctionStatus.LIVE };
    });

    if (result.action === 'START') {
      this.auctionGateway.sendAuctionUpdated({
        id: auctionId,
        status: AuctionStatus.LIVE,
      });
    } else if (result.action === 'CANCEL') {
      const endJob = await this.auctionQueue.getJob(`end_${auctionId}`);
      if (endJob) await endJob.remove();

      await this.updateAuctionCounts({ isCompleted: false });
      this.auctionGateway.sendAuctionUpdated({
        id: auctionId,
        status: result.status,
      });
    }
  }
  //Stop Auction
  async settleAuction(auctionId: string) {
    const redis = this.redisService.getClient();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const auctions = await tx.$queryRaw<any[]>`
          SELECT * FROM "Auction" WHERE "id" = ${auctionId} FOR UPDATE
        `;
        const auction = auctions[0];

        if (!auction || auction.status !== AuctionStatus.LIVE) {
          this.logger.warn(`${auctionId} Not Available Now`);
          return { action: 'SKIP' };
        }

        const now = Date.now();
        const actualEndAt = new Date(auction.endAt).getTime();
        const remainingMs = actualEndAt - now;

        if (remainingMs > 1000) {
          return { action: 'RESCHEDULE', newEndAt: auction.endAt };
        }

        const subscriptions = await tx.auctionSubscription.findMany({
          where: { auctionId },
        });

        if (subscriptions.length < auction.minParticipants) {
          this.logger.warn(`Deleting ${auctionId} (Insuffetient Bidders)`);

          for (const sub of subscriptions) {
            await this.walletService.unfreezeAmount(
              sub.userId,
              auction.depositRequired,
              tx,
            );
          }

          await this.walletService.unfreezeAmount(
            auction.sellerId,
            auction.sellerDepositFrozen,
            tx,
          );

          await tx.auction.update({
            where: { id: auctionId },
            data: { status: AuctionStatus.CANCELED_INSUFFICIENT_BIDDERS },
          });

          return {
            action: 'SETTLED',
            isCompleted: false,
            status: AuctionStatus.CANCELED_INSUFFICIENT_BIDDERS,
            winnerId: null,
            finalPrice: 0,
          };
        }

        const userHighestBids = await tx.bid.groupBy({
          by: ['userId'],
          where: { auctionId },
          _max: { amount: true },
        });

        const winningBid = await tx.bid.findFirst({
          where: { auctionId },
          orderBy: { amount: 'desc' },
        });

        if (!winningBid) {
          for (const sub of subscriptions) {
            await this.walletService.unfreezeAmount(
              sub.userId,
              auction.depositRequired,
              tx,
            );
          }

          await this.walletService.unfreezeAmount(
            auction.sellerId,
            auction.sellerDepositFrozen,
            tx,
          );

          await tx.auction.update({
            where: { id: auctionId },
            data: { status: AuctionStatus.RESERVE_NOT_MET },
          });

          return {
            action: 'SETTLED',
            isCompleted: false,
            status: AuctionStatus.RESERVE_NOT_MET,
            winnerId: null,
            finalPrice: 0,
          };
        }

        if (winningBid.amount < auction.reservePrice) {
          for (const sub of subscriptions) {
            await this.walletService.unfreezeAmount(
              sub.userId,
              auction.depositRequired,
              tx,
            );
          }

          await this.walletService.unfreezeAmount(
            auction.sellerId,
            auction.sellerDepositFrozen,
            tx,
          );

          await tx.auction.update({
            where: { id: auctionId },
            data: { status: AuctionStatus.RESERVE_NOT_MET },
          });

          return {
            action: 'SETTLED',
            isCompleted: false,
            status: AuctionStatus.RESERVE_NOT_MET,
            winnerId: null,
            finalPrice: winningBid.amount,
          };
        }

        for (const sub of subscriptions) {
          if (sub.userId !== winningBid.userId) {
            await this.walletService.unfreezeAmount(
              sub.userId,
              auction.depositRequired,
              tx,
            );
          }
        }

        await this.walletService.unfreezeAmount(
          winningBid.userId,
          auction.depositRequired,
          tx,
        );

        await this.walletService.deductFromBalance(
          winningBid.userId,
          auction.depositRequired,
          tx,
        );

        await this.walletService.unfreezeAmount(
          auction.sellerId,
          auction.sellerDepositFrozen,
          tx,
        );

        await tx.auction.update({
          where: { id: auctionId },
          data: {
            status: AuctionStatus.COMPLETED,
            currentPrice: winningBid.amount,
          },
        });

        return {
          action: 'SETTLED',
          isCompleted: true,
          status: AuctionStatus.COMPLETED,
          winnerId: winningBid.userId,
          finalPrice: winningBid.amount,
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    if (!result || result.action === 'SKIP') {
      return null;
    }

    if (result.action === 'RESCHEDULE') {
      await this.rescheduleAuctionEnd(auctionId, result.newEndAt);
      return { success: false, rescheduled: true };
    }

    if (result.action === 'SETTLED') {
      await redis.del(`auction:${auctionId}:live`);
      await this.updateAuctionCounts({
        isCompleted: result.isCompleted ?? false,
      });

      this.auctionGateway.sendAuctionUpdated({
        id: auctionId,
        status: result.status,
        currentPrice: result.finalPrice,
        winnerId: result.winnerId,
      });

      return {
        success: result.isCompleted,
        status: result.status,
        winnerId: result.winnerId,
        finalPrice: result.finalPrice,
      };
    }
  }
}
