import {
  Controller,
  Post,
  Delete,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuctionSubscriptionService } from './auction-subscription.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorator/get-user.decorator';

@Controller('auctions/:auctionId/subscribe')
@UseGuards(JwtAuthGuard)
export class AuctionSubscriptionController {
  constructor(
    private readonly subscriptionService: AuctionSubscriptionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async subscribe(
    @GetUser('id') userId: string,
    @Param('auctionId') auctionId: string,
  ) {
    const subscription = await this.subscriptionService.subscribe(
      userId,
      auctionId,
    );

    return {
      success: true,
      message: 'Subscribing and finance freeze succeed',
      data: subscription,
    };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async unsubscribe(
    @GetUser('id') userId: string,
    @Param('auctionId') auctionId: string,
  ) {
    await this.subscriptionService.unsubscribe(userId, auctionId);

    return {
      success: true,
      message: 'Unsubscribng succeed. and finance has been unfreezed',
    };
  }
}
