import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  ForbiddenException,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader, ApiParam } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional, IsBoolean } from 'class-validator';
import { AuthService, User } from './auth.service';

class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  role?: string;
}

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

class ApproveUserDto {
  @IsBoolean()
  approved: boolean;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  private async getAdminUser(authHeader: string): Promise<User> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }
    const token = authHeader.substring(7);
    const user = await this.authService.validateToken(token);
    
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
    
    return user;
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  async register(@Body() dto: RegisterDto) {
    this.logger.log(`Registering user: ${dto.email}`);
    return this.authService.register(dto.email, dto.password, dto.name, dto.role);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  async login(@Body() dto: LoginDto) {
    this.logger.log(`Login attempt: ${dto.email}`);
    return this.authService.login(dto.email, dto.password);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async logout(@Headers('authorization') authHeader: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }
    const token = authHeader.substring(7);
    await this.authService.logout(token);
    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getCurrentUser(@Headers('authorization') authHeader: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }
    const token = authHeader.substring(7);
    return this.authService.validateToken(token);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh token' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async refreshToken(@Headers('authorization') authHeader: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('No token provided');
    }
    const token = authHeader.substring(7);
    return this.authService.refreshToken(token);
  }

  // ==================== ADMIN ENDPOINTS ====================

  @Get('admin/users')
  @ApiOperation({ summary: 'Get all users (admin only)' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getAllUsers(@Headers('authorization') authHeader: string) {
    await this.getAdminUser(authHeader);
    return this.authService.getAllUsers();
  }

  @Get('admin/users/pending')
  @ApiOperation({ summary: 'Get pending approval users (admin only)' })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async getPendingUsers(@Headers('authorization') authHeader: string) {
    await this.getAdminUser(authHeader);
    return this.authService.getPendingUsers();
  }

  @Patch('admin/users/:id/approve')
  @ApiOperation({ summary: 'Approve or reject a user (admin only)' })
  @ApiParam({ name: 'id', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async approveUser(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: ApproveUserDto,
    @Headers('authorization') authHeader: string,
  ) {
    const admin = await this.getAdminUser(authHeader);
    return this.authService.approveUser(userId, dto.approved, admin.id);
  }

  @Patch('admin/users/:id/role')
  @ApiOperation({ summary: 'Update user role (admin only)' })
  @ApiParam({ name: 'id', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async updateUserRole(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: { role: string },
    @Headers('authorization') authHeader: string,
  ) {
    await this.getAdminUser(authHeader);
    return this.authService.updateUserRole(userId, dto.role);
  }

  @Patch('admin/users/:id/specialties')
  @ApiOperation({ summary: 'Update doctor specialties (admin only)' })
  @ApiParam({ name: 'id', type: String })
  @ApiHeader({ name: 'Authorization', description: 'Bearer token' })
  async updateUserSpecialties(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: { specialties: string[] },
    @Headers('authorization') authHeader: string,
  ) {
    await this.getAdminUser(authHeader);
    return this.authService.updateUserSpecialties(userId, dto.specialties);
  }
}

