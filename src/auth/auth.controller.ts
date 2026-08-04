// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  Get,
  Headers,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('google/mobile')
  @HttpCode(HttpStatus.OK)
  async googleWebLogin(
    @Body() body: Record<string, any>,
    @Headers('user-agent') deviceInfo: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const token = body?.accessToken || body?.idToken || body?.token;
    if (!token) {
      throw new UnauthorizedException('UNAUTHENTICATED');
    }

    const ipAddress = this.extractIp(req);

    const { access_token, refresh_token, user } =
      await this.authService.loginWithGoogleMobile(
        token,
        deviceInfo || 'Unknown Device',
        ipAddress,
      );

    this.setRefreshTokenCookie(res, refresh_token);

    return { access_token, user };
  }
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
    @Headers('user-agent') deviceInfo: string,
  ) {
    const refreshToken = req.cookies?.['refresh_token'];

    if (!refreshToken) {
      throw new UnauthorizedException('Session Expired');
    }

    const ipAddress = this.extractIp(req);

    const {
      access_token,
      refresh_token: newRefreshToken,
      user,
    } = await this.authService.refreshMobileSession(
      refreshToken,
      deviceInfo || 'Unknown Device',
      ipAddress,
    );

    this.setRefreshTokenCookie(res, newRefreshToken);

    return { access_token, user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const refreshToken = req.cookies?.['refresh_token'];

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    return { message: 'Logged out successfully' };
  }

  private setRefreshTokenCookie(res: any, token: string) {
    res.cookie('refresh_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  private extractIp(req: any): string {
    const xForwardedFor = req.headers?.['x-forwarded-for'];
    return Array.isArray(xForwardedFor)
      ? xForwardedFor[0]
      : typeof xForwardedFor === 'string'
        ? xForwardedFor.split(',')[0].trim()
        : req.socket?.remoteAddress || 'Unknown IP';
  }
  @Get('count')
  getUserCount() {
    return { totalUsers: this.authService.getTotalUsersCount() };
  }
}
