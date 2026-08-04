// src/auction-scheduler/auction-scheduler.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuctionSchedulerService } from './auction-scheduler.service';
import { AuctionTasksProcessor } from './auction-tasks.processor';
import { DatabaseModule } from '../database/database.module';
import { WalletModule } from '../wallet/wallet.module';
import { RedisModule } from '../redis/redis.module';
import { AuctionModule } from '../auction/auction.module';
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),

    BullModule.registerQueue({
      name: 'auction-tasks',
    }),

    DatabaseModule,
    WalletModule,
    RedisModule,
    forwardRef(() => AuctionModule),
  ],
  providers: [AuctionSchedulerService, AuctionTasksProcessor],
  exports: [AuctionSchedulerService],
})
export class AuctionSchedulerModule {}
