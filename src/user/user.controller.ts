import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '../auth/enum/roles.enum';
import { GetUser } from '../auth/decorator/get-user.decorator';
import { AuthService } from '../auth/auth.service';
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @Roles(Role.ADMIN)
  async getAllUsers() {
    return await this.userService.getAllUsers();
  }
  @Get('mybalance')
  async getMyBalance(@GetUser('id') userId: string) {
    return this.userService.getMyBalance(userId);
  }
  @Get('me')
  async getMe(@GetUser('id') id: string) {
    return await this.userService.getMe(id);
  }
  @Get('count')
  async getUserCount() {
    const totalUsers = await this.authService.getTotalUsersCount();
    return { totalUsers };
  }
  @Patch('me')
  async updateProfile(@GetUser('id') userId, @Body() dto: UpdateProfileDto) {
    return this.userService.updateProfile(userId, dto.phone, dto.username);
  }
}
