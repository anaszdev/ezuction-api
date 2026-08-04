import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuctionService } from './auction.service';
import { AuctionController } from './auction.controller';
import { AuctionGateway } from './auction.gateway';
import { BidService } from '../bid/bid.service';
import { DatabaseModule } from '../database/database.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuctionSchedulerModule } from '../auction-scheduler/auction-scheduler.module';
import { RedisModule } from '../redis/redis.module';
import { AuctionSubscriptionController } from './auction-subscription.controller';
import { AuctionSubscriptionService } from './auction-subscription.service';

@Module({
  imports: [
    DatabaseModule,
    WalletModule,
    AuctionSchedulerModule,
    RedisModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
    }),
  ],
  controllers: [AuctionController, AuctionSubscriptionController],
  providers: [
    AuctionService,
    AuctionGateway,
    BidService,
    AuctionSubscriptionService,
  ],
  exports: [AuctionGateway, AuctionService],
})
export class AuctionModule {}
