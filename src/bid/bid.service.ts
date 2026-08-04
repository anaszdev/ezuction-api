import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { AuctionSchedulerService } from '../auction-scheduler/auction-scheduler.service';
import { Prisma, ClosureType } from '@prisma/client';
import { AuctionGateway } from '../auction/auction.gateway';

@Injectable()
export class BidService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly redisService: RedisService,
    private readonly auctionSchedulerService: AuctionSchedulerService,
    @Inject(forwardRef(() => AuctionGateway))
    private readonly auctionGateway: AuctionGateway,
  ) {}
  //Getting auction base info
  async getAuctionSnapshot(auctionId: string, userId?: string) {
    const [auction, bids, subscription] = await Promise.all([
      this.prisma.auction.findUnique({
        where: { id: auctionId },
        select: {
          id: true,
          title: true,
          startingPrice: true,
          currentPrice: true,
          bidIncrement: true,
          depositRequired: true,
          status: true,
          startAt: true,
          endAt: true,
          sellerId: true,
        },
      }),

      this.prisma.bid.findMany({
        where: { auctionId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          bidder: {
            select: {
              id: true,
              fullName: true,
              picture: true,
            },
          },
        },
      }),

      userId
        ? this.prisma.auctionSubscription.findUnique({
            where: { userId_auctionId: { userId, auctionId } },
          })
        : Promise.resolve(null),
    ]);

    if (!auction) {
      throw new NotFoundException('The Auction does not exist in system');
    }

    const latestBid = bids.length > 0 ? bids[0] : null;

    return {
      auction,
      bids,
      currentPrice: auction.currentPrice ?? auction.startingPrice,
      endAt: auction.endAt,
      status: auction.status,
      winner: latestBid ? latestBid.bidder : null,
      isSubscribed: Boolean(subscription),
    };
  }
  //Handlng bid placing
  async placeBid(userId: string, auctionId: string, amount: number) {
    const redis = this.redisService.getClient();
    const cacheKey = `auction:${auctionId}:live`;

    const [cachedPrice, cachedIncrement, cachedStartPrice] = await redis.hmget(
      cacheKey,
      'currentPrice',
      'bidIncrement',
      'startingPrice',
    );

    if (cachedPrice && cachedIncrement) {
      const current = Number(cachedPrice);
      const increment = Number(cachedIncrement);
      const startPrice = Number(cachedStartPrice || 0);

      const minRequiredBid =
        current === 0 ? Math.max(startPrice, increment) : current + increment;

      if (amount < minRequiredBid) {
        throw new BadRequestException(
          `Error: Minimum value is ${minRequiredBid}`,
        );
      }
    }

    const [isSubscribed, auction] = await Promise.all([
      this.prisma.auctionSubscription.findUnique({
        where: { userId_auctionId: { userId, auctionId } },
      }),
      this.prisma.auction.findUnique({
        where: { id: auctionId },
        select: {
          sellerId: true,
          status: true,
          startingPrice: true,
          bidIncrement: true,
          endAt: true,
          bids: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: { userId: true },
          },
        },
      }),
    ]);

    if (!isSubscribed) {
      throw new BadRequestException('You should subscribe');
    }
    if (!auction) {
      throw new NotFoundException('This auction does not exist in the system');
    }
    if (auction.sellerId === userId) {
      throw new BadRequestException('You cannot bid on your own auction!');
    }
    if (auction.status !== 'LIVE') {
      throw new BadRequestException(
        'Bidding is closed! The auction is not live',
      );
    }

    const latestBidderId = auction.bids[0]?.userId;
    if (latestBidderId === userId) {
      throw new BadRequestException('You are already the highest bidder!');
    }

    try {
      const { createdBid, shouldExtend, finalEndAt } =
        await this.prisma.$transaction(async (tx) => {
          const currentAuctionList = await tx.$queryRaw<any[]>(
            Prisma.sql`SELECT "endAt", "bufferTime", "closureType", "startingPrice", "bidIncrement" FROM "Auction" WHERE "id" = ${auctionId} FOR UPDATE`,
          );
          const currentAuction = currentAuctionList[0];

          const now = Date.now();
          const currentEndTime = new Date(currentAuction.endAt).getTime();
          const bufferTimeMs = (currentAuction.bufferTime ?? 120) * 1000;
          const remainingTimeMs = currentEndTime - now;

          if (remainingTimeMs <= 0) {
            throw new BadRequestException('Error: Auction Ended');
          }

          const isSoftClose =
            currentAuction.closureType === ClosureType.SOFT &&
            Boolean(currentAuction.bufferTime);

          const isExtended =
            isSoftClose &&
            remainingTimeMs > 0 &&
            remainingTimeMs <= bufferTimeMs;

          const calculatedNewEndAt = isExtended
            ? new Date(now + bufferTimeMs)
            : new Date(currentAuction.endAt);

          const updatedAuctions: any[] = await tx.$queryRaw(
            Prisma.sql`
              UPDATE "Auction"
              SET "currentPrice" = ${amount}
                  ${isExtended ? Prisma.sql`, "endAt" = ${calculatedNewEndAt}` : Prisma.empty}
              WHERE "id" = ${auctionId}
                AND "status" = 'LIVE'
                AND (
                  ("currentPrice" = 0 AND ${amount} >= "startingPrice") OR
                  ("currentPrice" > 0 AND ${amount} >= ("currentPrice" + "bidIncrement"))
                )
              RETURNING "currentPrice", "endAt";
            `,
          );

          if (!updatedAuctions || updatedAuctions.length === 0) {
            throw new BadRequestException(
              'Task failed: someone placebid at the same moment',
            );
          }

          const bid = await tx.bid.create({
            data: { amount, auctionId, userId },
            include: {
              bidder: {
                select: { id: true, fullName: true, picture: true },
              },
            },
          });

          return {
            createdBid: bid,
            shouldExtend: isExtended,
            finalEndAt: calculatedNewEndAt,
          };
        });

      if (shouldExtend) {
        await this.auctionSchedulerService.rescheduleAuctionEnd(
          auctionId,
          finalEndAt,
        );
      }

      await redis.hset(cacheKey, {
        currentPrice: amount.toString(),
        startingPrice: auction.startingPrice.toString(),
        bidIncrement: auction.bidIncrement.toString(),
        endAt: finalEndAt.toISOString(),
      });

      this.auctionGateway.sendNewBid(auctionId, {
        bid: createdBid,
        newPrice: amount,
        newEndAt: finalEndAt,
      });

      return {
        ...createdBid,
        newEndAt: finalEndAt,
      };
    } catch (error) {
      console.error(' Error during placeBid execution:', error);
      throw error;
    }
  }
}
