import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DatabaseService } from '../database/database.service';

@Injectable()
export class UserService {
  constructor(private readonly db: DatabaseService) {}

  async getAllUsers() {
    return await this.db.user.findMany({
      select: {
        id: true,
        fullName: true,
        email: true,
        username: true,
        phone: true,
        picture: true,
        isProfileCompleted: true,
        createdAt: true,
      },
    });
  }

  async getMe(id: string) {
    const user = await this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        username: true,
        phone: true,
        picture: true,
        isProfileCompleted: true,
        createdAt: true,
        balance: true,
        frozenBalance: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User Not Found');
    }

    return user;
  }
  getMyBalance(userId: string) {
    return this.db.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
  }
  async updateProfile(userId: string, phone?: string, username?: string) {
    console.log(userId);
    const cleanPhone = phone?.trim();
    const cleanUsername = username?.trim().toLowerCase();

    const currentUser = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        username: true,
        isProfileCompleted: true,
      },
    });

    if (!currentUser) {
      throw new NotFoundException('User Not Found');
    }

    const updateData: Prisma.UserUpdateInput = {};
    const checkQueries: Promise<void>[] = [];

    if (cleanPhone && cleanPhone !== currentUser.phone) {
      if (cleanPhone.length < 8) {
        throw new BadRequestException('Invalid phone number');
      }
      updateData.phone = cleanPhone;
      checkQueries.push(
        this.db.user
          .findUnique({ where: { phone: cleanPhone } })
          .then((user) => {
            if (user && user.id !== userId) {
              throw new ConflictException(
                'Phone number is already used by another user',
              );
            }
          }),
      );
    }

    if (cleanUsername && cleanUsername !== currentUser.username) {
      if (cleanUsername.length < 3) {
        throw new BadRequestException('3 Letters at least');
      }
      const usernameRegex = /^[a-zA-Z0-9_]+$/;
      if (!usernameRegex.test(cleanUsername)) {
        throw new BadRequestException(
          'Username must have letters and numbers without spaces!',
        );
      }
      updateData.username = cleanUsername;
      checkQueries.push(
        this.db.user
          .findUnique({ where: { username: cleanUsername } })
          .then((user) => {
            if (user && user.id !== userId) {
              throw new ConflictException('Username is taken. Choose another');
            }
          }),
      );
    }

    if (Object.keys(updateData).length === 0) {
      return {
        message: 'No Changes',
        user: currentUser,
      };
    }

    if (checkQueries.length > 0) {
      await Promise.all(checkQueries);
    }

    const finalPhone = updateData.phone ?? currentUser.phone;
    const finalUsername = updateData.username ?? currentUser.username;

    if (finalPhone && finalUsername && !currentUser.isProfileCompleted) {
      updateData.isProfileCompleted = true;
    }

    try {
      const updatedUser = await this.db.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          fullName: true,
          email: true,
          username: true,
          phone: true,
          picture: true,
          isProfileCompleted: true,
        },
      });

      return {
        message: 'Profile updated',
        user: {
          ...updatedUser,
          isPhoneRequired: !updatedUser.phone,
        },
      };
    } catch (error) {
      //warning|| Race Condition Handling ||
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const target = (error.meta?.target as string[]) || [];
          if (target.includes('username')) {
            throw new ConflictException(
              'Username has been just taken by another user',
            );
          }
          if (target.includes('phone')) {
            throw new ConflictException(
              'Phone number has been just taken by another user',
            );
          }
        }
      }
      throw error;
    }
  }
}
