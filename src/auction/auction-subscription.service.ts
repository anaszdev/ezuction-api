import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { WalletService } from '../wallet/wallet.service';
import { AuctionStatus, Prisma } from '@prisma/client';
import { AuctionGateway } from './auction.gateway';
import { RedisService } from './../redis/redis.service';

@Injectable()
export class AuctionSubscriptionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly walletService: WalletService,
    private readonly auctionGateway: AuctionGateway,
    private readonly redisService: RedisService,
  ) {}
  //Handling Suscription
  async subscribe(userId: string, auctionId: string) {
    const redisSubscribersKey = `auction:${auctionId}:subscribers`;
    const redisCountKey = `auction:${auctionId}:subscribers_count`;

    const auction = await this.db.auction.findUnique({
      where: { id: auctionId },
      select: {
        id: true,
        depositRequired: true,
        startAt: true,
        status: true,
        sellerId: true,
      },
    });

    if (!auction) {
      throw new NotFoundException('Auction Not Found');
    }

    this.validateSubscriptionPossibility(auction, userId);

    const existingSubscription = await this.db.auctionSubscription.findUnique({
      where: {
        userId_auctionId: { userId, auctionId },
      },
    });

    if (existingSubscription) {
      await this.redisService.sadd(redisSubscribersKey, userId);
      throw new BadRequestException('You subscribed to this auction already');
    }

    let subscription;
    try {
      subscription = await this.db.$transaction(async (tx) => {
        await this.walletService.freezeAmount(
          userId,
          auction.depositRequired,
          tx,
        );

        return await tx.auctionSubscription.create({
          data: { userId, auctionId },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You subscribed to this auction already');
      }
      throw error;
    }

    try {
      await this.redisService.sadd(redisSubscribersKey, userId);
      const newCount = await this.redisService.incr(redisCountKey);
      this.auctionGateway.sendSubscriptionUpdated(auctionId, newCount);
    } catch (sideEffectError) {
      console.error('', sideEffectError);
    }

    return subscription;
  }

  async unsubscribe(userId: string, auctionId: string) {
    const redisSubscribersKey = `auction:${auctionId}:subscribers`;
    const redisCountKey = `auction:${auctionId}:subscribers_count`;

    const auction = await this.db.auction.findUnique({
      where: { id: auctionId },
      include: {
        subscribers: {
          where: { userId },
        },
      },
    });

    if (!auction) throw new NotFoundException('Auction Not Found');

    if (auction.subscribers.length === 0) {
      throw new BadRequestException('Not Subscribed');
    }

    this.validateUnsubscribePossibility(auction.status, auction.startAt);

    const result = await this.db.$transaction(async (tx) => {
      await this.walletService.unfreezeAmount(
        userId,
        auction.depositRequired,
        tx,
      );

      return tx.auctionSubscription.delete({
        where: { userId_auctionId: { userId, auctionId } },
      });
    });

    await this.redisService.srem(redisSubscribersKey, userId);

    await this.notifySubscribersCountUpdate(auctionId);

    return result;
  }

  private async notifySubscribersCountUpdate(auctionId: string) {
    const subscribersCount = await this.db.auctionSubscription.count({
      where: { auctionId },
    });

    this.auctionGateway.sendAuctionUpdated({
      id: auctionId,
      subscribersCount,
    });
  }

  private validateSubscriptionPossibility(auction: any, userId: string) {
    if (auction.status !== AuctionStatus.UPCOMING) {
      throw new BadRequestException(
        'you can subscribe to upcoming auction only',
      );
    }
    if (auction.sellerId === userId) {
      throw new BadRequestException(
        'You cannot subscribe to auction you created as seller',
      );
    }

    const now = new Date();
    const timeRemainingInMinutes =
      (new Date(auction.startAt).getTime() - now.getTime()) / (1000 * 60);

    if (timeRemainingInMinutes <= 15) {
      throw new BadRequestException({
        code: 'SUBSCRIPTION_CLOSED_NEAR_START',
        message: 'Subscription locked',
      });
    }
  }

  private validateUnsubscribePossibility(status: AuctionStatus, startAt: Date) {
    if (status !== AuctionStatus.UPCOMING) {
      throw new BadRequestException(
        'You cannot unsubscribe. the auction is live or ended',
      );
    }

    const now = new Date();
    const timeRemainingInMinutes =
      (new Date(startAt).getTime() - now.getTime()) / (1000 * 60);

    if (timeRemainingInMinutes <= 120) {
      throw new BadRequestException({
        code: 'SUBSCRIPTION_REMOVAL_LOCKED',
        message:
          'You cannot unsubscribed when live auction starts in less then 2 hrs',
      });
    }
  }
}
