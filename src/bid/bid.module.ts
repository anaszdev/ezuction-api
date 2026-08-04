import { Module, forwardRef } from '@nestjs/common';
import { BidService } from './bid.service';
import { DatabaseModule } from '../database/database.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuctionModule } from '../auction/auction.module';
import { AuctionSchedulerModule } from '../auction-scheduler/auction-scheduler.module';
@Module({
  providers: [BidService],
  imports: [
    DatabaseModule,
    WalletModule,
    AuctionModule,
    AuctionSchedulerModule,
  ],
})
export class BidModule {}
