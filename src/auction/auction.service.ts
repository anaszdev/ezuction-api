import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';
import { DatabaseService } from './../database/database.service';
import { AuctionFilterDto } from './dto/auction-filter.dto';
import { WalletService } from '../wallet/wallet.service';
import { AuctionStatus } from '@prisma/client';
import { AuctionSchedulerService } from '../auction-scheduler/auction-scheduler.service';
import { AuctionGateway } from './auction.gateway';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AuctionService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly walletService: WalletService,
    private readonly schedulerService: AuctionSchedulerService,
    private readonly auctionGateway: AuctionGateway,
    private readonly redisService: RedisService,
  ) {}
  //Calcuating auctions count for first time
  async onModuleInit() {
    try {
      const client = this.redisService.getClient();

      const upcomingExists = await client.exists('active_auctions_count');
      if (!upcomingExists) {
        const upcomingDbCount = await this.prisma.auction.count({
          where: { status: AuctionStatus.UPCOMING },
        });
        await client.set('active_auctions_count', upcomingDbCount);
      }

      const completedExists = await client.exists('completed_auctions_count');
      if (!completedExists) {
        const completedDbCount = await this.prisma.auction.count({
          where: { status: AuctionStatus.COMPLETED },
        });
        await client.set('completed_auctions_count', completedDbCount);
      }
    } catch (error) {
      console.error('Failed to initialize auction counts in Redis:', error);
    }
  }
  //getting auctions count by redis
  async getAuctionCounts(): Promise<{ upcoming: number; completed: number }> {
    const client = this.redisService.getClient();
    const [upcoming, completed] = await Promise.all([
      client.get('active_auctions_count'),
      client.get('completed_auctions_count'),
    ]);

    return {
      upcoming: upcoming ? parseInt(upcoming, 10) : 0,
      completed: completed ? parseInt(completed, 10) : 0,
    };
  }

  async createAuction(sellerId: string, dto: CreateAuctionDto) {
    const cleanSellerId =
      typeof sellerId === 'object' && sellerId !== null
        ? (sellerId as any).id || (sellerId as any).userId
        : sellerId;

    if (!cleanSellerId) {
      throw new BadRequestException('Missing SellerId');
    }
    //applying rules
    this.validateAuctionBusinessRules(dto);

    const startingPrice = Number(dto.startingPrice);
    const reservePrice = Number(dto.reservePrice);
    const sellerDepositRequired = Math.round(reservePrice * 0.2 * 100) / 100;
    const newAuction = await this.prisma.$transaction(
      async (tx) => {
        const updateResult = await tx.user.updateMany({
          where: {
            id: cleanSellerId,
            balance: { gte: sellerDepositRequired },
          },
          data: {
            balance: { decrement: sellerDepositRequired },
            frozenBalance: { increment: sellerDepositRequired },
          },
        });

        if (updateResult.count === 0) {
          throw new BadRequestException(
            `Insuffitient Balance(${sellerDepositRequired}).`,
          );
        }

        return await tx.auction.create({
          data: {
            title: dto.title,
            description: dto.description,
            images: dto.images,
            startingPrice: startingPrice,
            reservePrice: reservePrice,
            bidIncrement: dto.bidIncrement
              ? Number(dto.bidIncrement)
              : undefined,
            depositRequired: dto.depositRequired
              ? Number(dto.depositRequired)
              : undefined,
            city: dto.city,
            longitude: dto.longitude,
            latitude: dto.latitude,
            category: dto.category,
            closureType: dto.closureType,
            bufferTime: dto.bufferTime ? Number(dto.bufferTime) : undefined,
            minParticipants: dto.minParticipants
              ? Number(dto.minParticipants)
              : undefined,
            status: AuctionStatus.UPCOMING,
            sellerId: cleanSellerId,
            sellerDepositFrozen: sellerDepositRequired,
            startAt: new Date(dto.startAt),
            endAt: new Date(dto.endAt),
          },
        });
      },
      {
        maxWait: 10000,
        timeout: 15000,
      },
    );

    const client = this.redisService.getClient();
    const newUpcomingCount = await client.incr('active_auctions_count');

    this.auctionGateway.sendAuctionCreated(newAuction);
    this.auctionGateway.sendAuctionCountsUpdate({
      upcoming: newUpcomingCount,
    });

    await this.schedulerService.scheduleAuctionJobs(
      newAuction.id,
      newAuction.startAt,
      newAuction.endAt,
    );

    return newAuction;
  }

  //Handling Auction Delete
  async deleteAuction(auctionId: string, sellerId: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      include: { subscribers: true },
    });

    if (!auction) throw new NotFoundException('Auction Not Found');
    if (auction.sellerId !== sellerId)
      throw new ForbiddenException('unautherized');
    if (auction.status !== AuctionStatus.UPCOMING) {
      throw new BadRequestException(
        'You cannot delete auctions already started!',
      );
    }

    const now = new Date();
    const timeRemainingInMinutes =
      (new Date(auction.startAt).getTime() - now.getTime()) / (1000 * 60);

    if (auction.subscribers.length === 0) {
      if (timeRemainingInMinutes <= 15)
        throw new BadRequestException('Auction locked');

      const result = await this.prisma.$transaction(async (tx) => {
        await this.walletService.unfreezeAmount(
          sellerId,
          auction.sellerDepositFrozen,
          tx,
        );
        return await tx.auction.delete({
          where: { id: auctionId },
        });
      });

      await this.schedulerService.cancelAuctionJobs(auctionId);

      const client = this.redisService.getClient();
      const rawCount = await client.decr('active_auctions_count');
      const safeCount = Math.max(0, rawCount);
      if (rawCount < 0) await client.set('active_auctions_count', 0);

      this.auctionGateway.sendAuctionCountsUpdate({ upcoming: safeCount });
      return result;
    }

    if (timeRemainingInMinutes <= 120)
      throw new BadRequestException(
        'You cannot delete auction while there is subscribers',
      );

    return await this.prisma.$transaction(async (tx) => {
      const subscriberIds = auction.subscribers.map((sub) => sub.userId);
      if (subscriberIds.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: subscriberIds } },
          data: {
            balance: { increment: auction.depositRequired },
            frozenBalance: { decrement: auction.depositRequired },
          },
        });
      }

      await this.walletService.unfreezeAmount(
        sellerId,
        auction.sellerDepositFrozen,
        tx,
      );

      const updated = await tx.auction.update({
        where: { id: auctionId },
        data: { status: AuctionStatus.CANCELED },
      });

      await this.schedulerService.cancelAuctionJobs(auctionId);

      const client = this.redisService.getClient();
      const rawCount = await client.decr('active_auctions_count');
      const safeCount = Math.max(0, rawCount);
      if (rawCount < 0) await client.set('active_auctions_count', 0);

      this.auctionGateway.sendAuctionCountsUpdate({ upcoming: safeCount });
      return updated;
    });
  }
  // For Admin

  async getAuction(id: string) {
    return this.prisma.auction.findUnique({ where: { id } });
  }

  async getUpcomingAuctions(filters: Omit<AuctionFilterDto, 'status'>) {
    const { category, city, maxPrice, page = 1, limit = 10 } = filters;
    const skip = (page - 1) * limit;

    const whereClause: any = {
      status: AuctionStatus.UPCOMING,
    };

    if (category) whereClause.category = category;
    if (city) whereClause.city = city;
    if (maxPrice) whereClause.currentPrice = { lte: Number(maxPrice) };

    const auctions = await this.prisma.auction.findMany({
      where: whereClause,
      skip: skip,
      take: Number(limit),
      orderBy: { startAt: 'asc' },
      include: {
        seller: {
          select: {
            fullName: true,
            picture: true,
          },
        },
        _count: {
          select: {
            subscribers: true,
          },
        },
      },
    });

    return auctions.map((auction) => ({
      ...auction,
      subscribersCount: auction._count?.subscribers || 0,
      currentPrice:
        auction.currentPrice > 0 ? auction.currentPrice : auction.startingPrice,
    }));
  }

  private validateAuctionBusinessRules(dto: CreateAuctionDto) {
    const nowUtc = new Date().getTime();
    const auctionStartUtc = new Date(dto.startAt).getTime();
    const auctionEndUtc = new Date(dto.endAt).getTime();

    if (auctionEndUtc <= auctionStartUtc)
      throw new BadRequestException('End time must be after start time');
    if (dto.reservePrice < dto.startingPrice)
      throw new BadRequestException(
        'Reserve Price must be higher than Starting Price',
      );
  }
  //Get users subscriptions auctions
  async subscribedAuctions(userId: string) {
    const subscriptions = await this.prisma.auctionSubscription.findMany({
      where: {
        userId: userId,
        auction: {
          status: {
            in: [AuctionStatus.UPCOMING, AuctionStatus.LIVE],
          },
        },
      },
      include: {
        auction: {
          include: {
            seller: {
              select: {
                fullName: true,
                picture: true,
              },
            },
            _count: {
              select: { subscribers: true },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return subscriptions.map((sub) => ({
      ...sub.auction,
      subscribersCount: sub.auction._count?.subscribers || 0,
      currentPrice:
        sub.auction.currentPrice > 0
          ? sub.auction.currentPrice
          : sub.auction.startingPrice,
      _count: undefined,
    }));
  }

  async getMyCreatedAuctions(userId: string) {
    return await this.prisma.auction.findMany({
      where: {
        sellerId: userId,
        status: { in: [AuctionStatus.LIVE, AuctionStatus.UPCOMING] },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        title: true,
        images: true,
        description: true,
        depositRequired: true,
        startAt: true,
        status: true,
        createdAt: true,
        _count: {
          select: {
            subscribers: true,
          },
        },
      },
    });
  }
  async getAll() {
    return this.prisma.auction.findMany();
  }
  async deleteAll() {
    await this.prisma.auction.deleteMany();
    return 'success!!';
  }
}
