import { NextRequest, NextResponse } from 'next/server';
import { vpnSubnetCheck, errorResponse } from '@/lib/middleware';
import {
  verifyRefreshToken,
  getSessionByRefreshToken,
  generateTokens,
  updateSessionActivity,
  getUserById
} from '@/lib/auth';

export async function POST(request: NextRequest) {
  // Check VPN subnet
  const vpnCheckResult = await vpnSubnetCheck(request);
  if (vpnCheckResult) return vpnCheckResult;

  try {
    const body = await request.json();
    const { refresh_token } = body;

    if (!refresh_token) {
      return errorResponse('AUTH_001', 'Refresh token required', 400);
    }

    // Verify refresh token
    try {
      verifyRefreshToken(refresh_token);
    } catch {
      return errorResponse('AUTH_003', 'Invalid refresh token', 401);
    }

    // Get session
    const session = await getSessionByRefreshToken(refresh_token);
    if (!session) {
      return errorResponse('AUTH_004', 'Session expired', 401);
    }

    // Get user
    const user = await getUserById(session.user_id);
    if (!user) {
      return errorResponse('AUTH_001', 'User not found', 401);
    }

    // Update session activity
    await updateSessionActivity(session.id);

    // Generate new access token
    const { accessToken } = generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id
    });

    return NextResponse.json({
      access_token: accessToken,
      expires_in: 900 // 15 minutes
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}