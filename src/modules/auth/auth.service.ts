import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import * as crypto from 'crypto';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar_url: string | null;
  is_active: boolean;
  is_approved: boolean;
  created_at: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  expiresAt: string;
  pendingApproval?: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly TOKEN_EXPIRY_HOURS = 24;

  constructor(private readonly supabase: SupabaseService) {}

  // Simple password hashing using crypto (no external dependencies)
  private hashPassword(password: string, salt?: string): { hash: string; salt: string } {
    const useSalt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto
      .pbkdf2Sync(password, useSalt, 10000, 64, 'sha512')
      .toString('hex');
    return { hash: `${useSalt}:${hash}`, salt: useSalt };
  }

  private verifyPassword(password: string, storedHash: string): boolean {
    const [salt, hash] = storedHash.split(':');
    const { hash: newHash } = this.hashPassword(password, salt);
    return storedHash === newHash;
  }

  async register(
    email: string,
    password: string,
    name: string,
    role: string = 'doctor',
  ): Promise<AuthResponse> {
    // Validate input
    if (!email || !password || !name) {
      throw new BadRequestException('Email, password, and name are required');
    }

    if (password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    // Check if user exists
    const { data: existingUser } = await this.supabase.client
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const { hash: passwordHash } = this.hashPassword(password);

    // Create user with is_approved = false (requires admin approval)
    const { data: user, error } = await this.supabase.client
      .from('users')
      .insert({
        email: email.toLowerCase(),
        password_hash: passwordHash,
        name,
        role,
        is_approved: false, // New users need admin approval
      })
      .select('id, email, name, role, avatar_url, is_active, is_approved, created_at')
      .single();

    if (error) {
      this.logger.error('Error creating user:', error);
      throw new BadRequestException('Failed to create user');
    }

    this.logger.log(`New user registered: ${email}, role: ${role}, pending approval`);

    // Return user info but no session - they need approval first
    return {
      user: user as User,
      token: '', // No token for unapproved users
      expiresAt: new Date().toISOString(),
      pendingApproval: true,
    };
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    // Find user
    const { data: user, error } = await this.supabase.client
      .from('users')
      .select('id, email, name, role, avatar_url, is_active, is_approved, password_hash, created_at')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('Account is disabled');
    }

    // Verify password
    const isValid = this.verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check if user is approved
    if (!user.is_approved) {
      this.logger.log(`Login attempt by unapproved user: ${email}`);
      const { password_hash, ...safeUser } = user;
      return {
        user: safeUser as User,
        token: '',
        expiresAt: new Date().toISOString(),
        pendingApproval: true,
      };
    }

    // Update last login
    await this.supabase.client
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    // Create session
    const { token, expiresAt } = await this.createSession(user.id);

    // Remove password_hash from response
    const { password_hash, ...safeUser } = user;

    return {
      user: safeUser as User,
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async logout(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    
    await this.supabase.client
      .from('sessions')
      .delete()
      .eq('token_hash', tokenHash);
  }

  async validateToken(token: string): Promise<User> {
    const tokenHash = this.hashToken(token);

    const { data: session, error } = await this.supabase.client
      .from('sessions')
      .select(`
        id,
        expires_at,
        users (
          id,
          email,
          name,
          role,
          avatar_url,
          is_active,
          is_approved,
          created_at
        )
      `)
      .eq('token_hash', tokenHash)
      .single();

    if (error || !session) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Check if token expired
    if (new Date(session.expires_at) < new Date()) {
      // Clean up expired session
      await this.supabase.client
        .from('sessions')
        .delete()
        .eq('id', session.id);
      throw new UnauthorizedException('Token expired');
    }

    const user = session.users as any;
    if (!user || !user.is_active) {
      throw new UnauthorizedException('User not found or disabled');
    }

    if (!user.is_approved) {
      throw new UnauthorizedException('Account pending approval');
    }

    return user as User;
  }

  async refreshToken(oldToken: string): Promise<AuthResponse> {
    // Validate current token
    const user = await this.validateToken(oldToken);

    // Delete old session
    await this.logout(oldToken);

    // Create new session
    const { token, expiresAt } = await this.createSession(user.id);

    return {
      user,
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + this.TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    const { error } = await this.supabase.client
      .from('sessions')
      .insert({
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      });

    if (error) {
      this.logger.error('Error creating session:', error);
      throw new BadRequestException('Failed to create session');
    }

    return { token, expiresAt };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ==================== ADMIN METHODS ====================

  async getAllUsers(): Promise<User[]> {
    const { data, error } = await this.supabase.client
      .from('users')
      .select('id, email, name, role, avatar_url, is_active, is_approved, created_at, approved_at')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Error fetching users:', error);
      throw new BadRequestException('Failed to fetch users');
    }

    return data as User[];
  }

  async getPendingUsers(): Promise<User[]> {
    const { data, error } = await this.supabase.client
      .from('users')
      .select('id, email, name, role, avatar_url, is_active, is_approved, created_at')
      .eq('is_approved', false)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Error fetching pending users:', error);
      throw new BadRequestException('Failed to fetch pending users');
    }

    return data as User[];
  }

  async approveUser(userId: string, approved: boolean, adminId: string): Promise<User> {
    const updateData: Record<string, unknown> = {
      is_approved: approved,
    };

    if (approved) {
      updateData.approved_at = new Date().toISOString();
      updateData.approved_by = adminId;
    } else {
      updateData.approved_at = null;
      updateData.approved_by = null;
    }

    const { data, error } = await this.supabase.client
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, name, role, avatar_url, is_active, is_approved, created_at, approved_at')
      .single();

    if (error) {
      this.logger.error('Error updating user approval:', error);
      throw new BadRequestException('Failed to update user approval');
    }

    this.logger.log(`User ${userId} ${approved ? 'approved' : 'rejected'} by admin ${adminId}`);
    return data as User;
  }

  async updateUserRole(userId: string, role: string): Promise<User> {
    const validRoles = ['doctor', 'admin', 'staff', 'sales_agent'];
    if (!validRoles.includes(role)) {
      throw new BadRequestException(`Invalid role. Valid roles: ${validRoles.join(', ')}`);
    }

    const { data, error } = await this.supabase.client
      .from('users')
      .update({ role })
      .eq('id', userId)
      .select('id, email, name, role, avatar_url, is_active, is_approved, created_at')
      .single();

    if (error) {
      this.logger.error('Error updating user role:', error);
      throw new BadRequestException('Failed to update user role');
    }

    this.logger.log(`User ${userId} role updated to ${role}`);
    return data as User;
  }
}

