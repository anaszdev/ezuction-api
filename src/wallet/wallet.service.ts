import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { UpdateDepositStatusDto } from './dto/update-deposit-status.dto';
import { DepositStatus, Prisma } from '@prisma/client';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: DatabaseService) {}

  //note ========================== DEPOSIT STUFF ============================ //
  //! === Admin === //
  async allDepositRequests() {
    return await this.prisma.depositRequest.findMany();
  }
  async processDeposit(requestId: string, dto: UpdateDepositStatusDto) {
    const depositRequest = await this.prisma.depositRequest.findUnique({
      where: { id: requestId },
    });

    if (!depositRequest) {
      throw new NotFoundException('Not Found');
    }

    if (depositRequest.status !== DepositStatus.PENDING) {
      throw new BadRequestException({
        code: 'DEPOSIT_ALREADY_PROCESSED',
        message: 'Error: Deposit Already Processed',
      });
    }

    if (dto.status === DepositStatus.REJECTED) {
      return this.prisma.depositRequest.update({
        where: { id: requestId },
        data: { status: DepositStatus.REJECTED },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.depositRequest.updateMany({
        where: {
          id: requestId,
          status: DepositStatus.PENDING,
        },
        data: { status: DepositStatus.APPROVED },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException({
          code: 'DEPOSIT_ALREADY_PROCESSED',
          message: 'Error: Deposit Already Processed',
        });
      }

      await tx.user.update({
        where: { id: depositRequest.userId },
        data: {
          balance: { increment: depositRequest.amount },
        },
      });

      return tx.depositRequest.findUnique({ where: { id: requestId } });
    });
  }
  //! === Users === //
  async requestDeposit(userId: string, dto: CreateDepositDto) {
    const existingTx = await this.prisma.depositRequest.findUnique({
      where: { transactionNo: dto.transactionNo },
    });

    if (existingTx) {
      throw new ConflictException({
        code: 'TRANSACTION_ALREADY_EXISTS',
        message: 'Error: Transaction already exists',
      });
    }

    return this.prisma.depositRequest.create({
      data: {
        amount: dto.amount,
        transactionNo: dto.transactionNo,
        receiptImage: dto.receiptImage,
        userId: userId,
        status: DepositStatus.PENDING,
      },
    });
  }

  async getWalletBalance(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        balance: true,
        frozenBalance: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User Not Found');
    }
    return user;
  }
  //note ============================== FINANCIAL TERMS =============================== //
  async freezeAmount(
    userId: string,
    amount: number,
    prismaTx?: Prisma.TransactionClient,
  ) {
    if (!prismaTx) {
      return this.prisma.$transaction(async (tx) => {
        return this.executeFreeze(userId, amount, tx);
      });
    }
    return this.executeFreeze(userId, amount, prismaTx);
  }

  async unfreezeAmount(
    userId: string,
    amount: number,
    prismaTx?: Prisma.TransactionClient,
  ) {
    if (!prismaTx) {
      return this.prisma.$transaction(async (tx) => {
        return this.executeUnfreeze(userId, amount, tx);
      });
    }
    return this.executeUnfreeze(userId, amount, prismaTx);
  }

  async deductFromFrozen(
    userId: string,
    amount: number,
    prismaTx?: Prisma.TransactionClient,
  ) {
    if (!prismaTx) {
      return this.prisma.$transaction(async (tx) => {
        return this.executeDeduct(userId, amount, tx);
      });
    }
    return this.executeDeduct(userId, amount, prismaTx);
  }

  private async executeFreeze(
    userId: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ) {
    const updateResult = await tx.user.updateMany({
      where: {
        id: userId,
        balance: { gte: amount },
      },
      data: {
        balance: { decrement: amount },
        frozenBalance: { increment: amount },
      },
    });

    if (updateResult.count === 0) {
      const userExists = await tx.user.findUnique({ where: { id: userId } });
      if (!userExists) {
        throw new NotFoundException('User Not Found');
      }
      throw new BadRequestException('Insuffecient Balance');
    }

    return tx.user.findUnique({ where: { id: userId } });
  }

  private async executeUnfreeze(
    userId: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ) {
    const updateResult = await tx.user.updateMany({
      where: {
        id: userId,
        frozenBalance: { gte: amount },
      },
      data: {
        balance: { increment: amount },
        frozenBalance: { decrement: amount },
      },
    });

    if (updateResult.count === 0) {
      const userExists = await tx.user.findUnique({ where: { id: userId } });
      if (!userExists) {
        throw new NotFoundException('User Not Found');
      }
      throw new BadRequestException('Technical Mistake');
    }

    return tx.user.findUnique({ where: { id: userId } });
  }
  private async executeDeductFromBalance(
    userId: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ) {
    const updateResult = await tx.user.updateMany({
      where: {
        id: userId,
        balance: { gte: amount },
      },
      data: {
        balance: { decrement: amount },
      },
    });

    if (updateResult.count === 0) {
      const userExists = await tx.user.findUnique({ where: { id: userId } });
      if (!userExists) {
        throw new NotFoundException('User Not Found');
      }
      throw new BadRequestException('Technical Mistake');
    }

    return tx.user.findUnique({ where: { id: userId } });
  }
  private async executeDeduct(
    userId: string,
    amount: number,
    tx: Prisma.TransactionClient,
  ) {
    const updateResult = await tx.user.updateMany({
      where: {
        id: userId,
        frozenBalance: { gte: amount },
      },
      data: {
        frozenBalance: { decrement: amount },
      },
    });

    if (updateResult.count === 0) {
      const userExists = await tx.user.findUnique({ where: { id: userId } });
      if (!userExists) {
        throw new NotFoundException('User Not Found');
      }
      throw new BadRequestException('Technical Mistake');
    }

    return tx.user.findUnique({ where: { id: userId } });
  }
  async deductFromBalance(
    userId: string,
    amount: number,
    prismaTx?: Prisma.TransactionClient,
  ) {
    if (!prismaTx) {
      return this.prisma.$transaction(async (tx) => {
        return this.executeDeductFromBalance(userId, amount, tx);
      });
    }
    return this.executeDeductFromBalance(userId, amount, prismaTx);
  }
}
