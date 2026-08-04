// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from './redis/redis.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AuctionModule } from './auction/auction.module';
import { UserModule } from './user/user.module';
import { WalletModule } from './wallet/wallet.module';
import { AuctionSchedulerModule } from './auction-scheduler/auction-scheduler.module';
import { BidModule } from './bid/bid.module';
import { UploadController } from './upload/upload.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RedisModule,
    DatabaseModule,
    AuthModule,
    AuctionModule,
    UserModule,
    WalletModule,
    AuctionSchedulerModule,
    BidModule,
  ],
  controllers: [AppController, UploadController],
  providers: [AppService],
})
export class AppModule {}
