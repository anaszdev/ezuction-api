import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { DatabaseModule } from './../database/database.module';

@Module({
  controllers: [WalletController],
  providers: [WalletService],
  imports: [DatabaseModule],
  exports: [WalletService],
})
export class WalletModule {}
