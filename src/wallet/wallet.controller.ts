import {
  Controller,
  Post,
  Body,
  Patch,
  Param,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { UpdateDepositStatusDto } from './dto/update-deposit-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '../auth/enum/roles.enum';
import { GetUser } from '../auth/decorator/get-user.decorator';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post('deposit/request')
  @HttpCode(HttpStatus.CREATED)
  async requestDeposit(
    @GetUser('id') userId: string,
    @Body() dto: CreateDepositDto,
  ) {
    const deposit = await this.walletService.requestDeposit(userId, dto);
    return {
      success: true,
      message: 'Process succeed. waiting for admin validation',
      data: deposit,
    };
  }

  @Patch('deposit/:id/process')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async processDeposit(
    @Param('id') requestId: string,
    @Body() dto: UpdateDepositStatusDto,
  ) {
    const updatedRequest = await this.walletService.processDeposit(
      requestId,
      dto,
    );
    return {
      success: true,
      message:
        dto.status === 'APPROVED'
          ? 'Process succeed. money has transfered to the user'
          : 'The request rejected. transaction closed',
      data: updatedRequest,
    };
  }

  @Get('balance')
  @HttpCode(HttpStatus.OK)
  async getWalletBalance(@GetUser('id') userId: string) {
    const balances = await this.walletService.getWalletBalance(userId);
    return {
      success: true,
      data: {
        availableBalance: balances.balance,
        frozenBalance: balances.frozenBalance,
        totalBalance: balances.balance + balances.frozenBalance,
      },
    };
  }
  @Get('depo')
  async allDepositRequests() {
    return this.walletService.allDepositRequests();
  }
}
