import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { vpnSubnetCheck, errorResponse } from '@/lib/middleware';
import {
  getUserByCredentials,
  verifyPassword,
  generateDeviceId,
  generateTokens,
  createSession
} from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  // Check VPN subnet
  const vpnCheckResult = await vpnSubnetCheck(request);
  if (vpnCheckResult) return vpnCheckResult;

  try {
    const body = await request.json();
    const { username, password, device_name } = body;
    
    console.log('[LOGIN] Attempting login for username:', username);

    // Validate input
    if (!username || !password) {
      console.log('[LOGIN] Missing username or password');
      return errorResponse('AUTH_001', 'Invalid credentials', 400);
    }

    // Get user
    console.log('[LOGIN] Looking up user in database...');
    const user = await getUserByCredentials(username);
    if (!user) {
      console.log('[LOGIN] User not found in database');
      return errorResponse('AUTH_001', 'Invalid credentials', 401);
    }
    console.log('[LOGIN] User found:', { id: user.id, username: user.username, email: user.email });

    // Verify password
    console.log('[LOGIN] Verifying password...');
    const isValidPassword = await verifyPassword(password, user.password_hash);
    console.log('[LOGIN] Password valid:', isValidPassword);
    if (!isValidPassword) {
      console.log('[LOGIN] Invalid password');
      return errorResponse('AUTH_001', 'Invalid credentials', 401);
    }

    // Get client info
    const clientIP = request.headers.get('x-real-ip') || 
                     request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     '127.0.0.1';
    const userAgent = request.headers.get('user-agent') || '';
    const deviceId = generateDeviceId(userAgent, clientIP);

    // Generate tokens
    const { refreshToken } = generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: '' // Will be set after session creation
    });

    // Create session
    const session = await createSession(
      user.id,
      deviceId,
      device_name || 'Unknown Device',
      clientIP,
      userAgent,
      refreshToken
    );

    // Update tokens with session ID
    const tokensWithSession = generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id
    });

    // Update session with new refresh token hash
    const newRefreshTokenHash = crypto.createHash('sha256').update(tokensWithSession.refreshToken).digest('hex');
    await query(
      'UPDATE sessions SET refresh_token_hash = $1 WHERE id = $2',
      [newRefreshTokenHash, session.id]
    );

    // Update last login
    await query(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    return NextResponse.json({
      access_token: tokensWithSession.accessToken,
      refresh_token: tokensWithSession.refreshToken,
      expires_in: 900, // 15 minutes
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        full_name: user.full_name
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}