import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { AuctionService } from './auction.service';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { UpdateAuctionDto } from './dto/update-auction.dto';
import { GetUser } from './../auth/decorator/get-user.decorator';
import { JwtAuthGuard } from './../auth/guards/jwt-auth.guard';
import { AuctionFilterDto } from './dto/auction-filter.dto';
import { Role } from '../auth/enum/roles.enum';
import { Roles } from '../auth/decorator/roles.decorator';
@Controller('auctions')
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@GetUser('id') sellerId: string, @Body() dto: CreateAuctionDto) {
    return this.auctionService.createAuction(sellerId, dto);
  }
  @Get()
  async getAll() {
    return this.auctionService.getAll();
  }
  @Get('my-created')
  @UseGuards(JwtAuthGuard)
  async getMyCreatedAuctions(@GetUser('id') userId: string) {
    return this.auctionService.getMyCreatedAuctions(userId);
  }
  @Get('upcoming')
  // @UseGuards(JwtAuthGuard)
  async getAllAuction(@Query() filters: AuctionFilterDto) {
    return this.auctionService.getUpcomingAuctions(filters);
  }
  @Get('counts')
  async getAuctionCounts() {
    return await this.auctionService.getAuctionCounts();
  }
  @Delete()
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN)
  async deleteAll() {
    return this.auctionService.deleteAll();
  }
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteAuction(
    @Param('id') auctionId: string,
    @GetUser('id') sellerId: string,
  ) {
    return this.auctionService.deleteAuction(auctionId, sellerId);
  }
  @Get('subscribed')
  @UseGuards(JwtAuthGuard)
  async getSubscribedAuctions(@GetUser('id') userId: string) {
    return this.auctionService.subscribedAuctions(userId);
  }
  @Get(':id')
  async getAuction(@Param('id') id: string) {
    return this.auctionService.getAuction(id);
  }
}
