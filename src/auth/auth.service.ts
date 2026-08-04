import {
  Injectable,
  UnauthorizedException,
  OnModuleInit,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID, createHash } from 'crypto';
import { User } from '@prisma/client';
import { AuctionGateway } from '../auction/auction.gateway';
import Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';
@Injectable()
export class AuthService implements OnModuleInit {
  private totalUsersCount = 0;

  constructor(
    private readonly prisma: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly auctionGateway: AuctionGateway,
    private readonly redisService: RedisService,
  ) {}
  //Fetching counts data for first time
  async onModuleInit() {
    try {
      const client = this.redisService.getClient();
      const exists = await client.exists('total_users_count');

      if (!exists) {
        const dbCount = await this.prisma.user.count();
        await client.set('total_users_count', dbCount);
      }
    } catch (error) {
      console.error('Failed to initialize user count in Redis:', error);
    }
  }
  //Get users count
  async getTotalUsersCount(): Promise<number> {
    const client = this.redisService.getClient();
    const count = await client.get('total_users_count');
    return count ? parseInt(count, 10) : await this.prisma.user.count();
  }
  //We are using google auth
  async loginWithGoogleMobile(
    token: string,
    deviceInfo: string,
    ipAddress: string,
  ) {
    try {
      let email: string | undefined;
      let name: string | undefined;
      let picture: string | undefined;
      let googleId: string | undefined;

      const isIdToken = token.split('.').length === 3;

      if (isIdToken) {
        const clientId =
          process.env.GOOGLE_CLIENT_ID ||
          '242226138873-i980h9s9bd0oro1vqs0v6bm1kegkujgt.apps.googleusercontent.com';

        const googleClient = new OAuth2Client(clientId);

        const ticket = await googleClient.verifyIdToken({
          idToken: token,
          audience: clientId,
        });

        const payload = ticket.getPayload();
        email = payload?.email;
        name = payload?.name;
        picture = payload?.picture;
        googleId = payload?.sub;
      } else {
        const response = await fetch(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          throw new UnauthorizedException(
            'Incoming token from google is incorrect or expired',
          );
        }

        const userData = await response.json();
        email = userData.email;
        name = userData.name;
        picture = userData.picture;
        googleId = userData.sub;
      }

      if (!email) {
        throw new UnauthorizedException('Token missing email');
      }

      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      });

      let user: User;
      let isNewUser = false;

      if (!existingUser) {
        isNewUser = true;
        user = await this.prisma.user.create({
          data: {
            email: email,
            googleId: googleId ?? '',
            fullName: name || 'user',
            picture: picture,
            role: 'USER',
          },
        });
      } else {
        user = await this.prisma.user.update({
          where: { email },
          data: {
            fullName: name || 'user',
            picture: picture,
            ...(googleId && { googleId }),
            lastSeenAt: new Date(),
          },
        });
      }

      if (user.deletedAt) {
        throw new UnauthorizedException('This account is expired');
      }

      if (isNewUser) {
        const client = this.redisService.getClient();
        const newCount = await client.incr('total_users_count');
        this.auctionGateway.sendTotalUsersUpdate(newCount);
      }
      return this.generateAndSaveTokens(user, deviceInfo, ipAddress);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('google verifing failed');
    }
  }

  private async generateAndSaveTokens(
    user: Partial<User> & {
      id: string;
      email: string;
      role: string;
      fullName: string;
    },
    deviceInfo: string,
    ipAddress: string,
    prismaInstance: any = this.prisma,
  ) {
    const sessionId = randomUUID();

    const accessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.fullName,
    };
    const refreshPayload = { sub: user.id, email: user.email, jti: sessionId };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: '1d',
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: '7d',
      }),
    ]);

    const hashedToken = createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prismaInstance.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        hashedToken,
        userAgent: deviceInfo,
        ipAddress,
        expiresAt,
      },
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        picture: user.picture ?? null,
        phone: user.phone ?? null,
        role: user.role,
        balance: user.balance ?? 0.0,
        frozenBalance: user.frozenBalance ?? 0.0,
        isPhoneRequired: !user.phone,
      },
    };
  }

  async refreshMobileSession(
    refreshToken: string,
    deviceInfo: string,
    ipAddress: string,
  ) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      const sessionId = payload.jti;
      if (!sessionId) {
        throw new UnauthorizedException('Invalid Token');
      }

      const currentHash = createHash('sha256')
        .update(refreshToken)
        .digest('hex');

      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });

      if (
        !session ||
        session.expiresAt.getTime() < Date.now() ||
        session.revoked ||
        session.user.deletedAt ||
        session.hashedToken !== currentHash
      ) {
        throw new UnauthorizedException('Invalid Or Expired Session');
      }

      await this.prisma.session
        .deleteMany({
          where: { id: sessionId },
        })
        .catch(() => {});

      return this.generateAndSaveTokens(session.user, deviceInfo, ipAddress);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Re sign');
    }
  }

  async logout(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      const sessionId = payload.jti;
      if (!sessionId) return;

      const currentHash = createHash('sha256')
        .update(refreshToken)
        .digest('hex');

      await this.prisma.session.deleteMany({
        where: {
          id: sessionId,
          hashedToken: currentHash,
        },
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Google verifing failed');
    }
  }
}
