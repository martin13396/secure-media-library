import { NextRequest, NextResponse } from 'next/server';
import { vpnSubnetCheck, authCheck, errorResponse } from '@/lib/middleware';
import { deleteSession, deleteAllUserSessions, getSessionByRefreshToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  // Check VPN subnet
  const vpnCheckResult = await vpnSubnetCheck(request);
  if (vpnCheckResult) return vpnCheckResult;

  // Check authentication
  const authResult = await authCheck(request);
  if (authResult.response) return authResult.response;

  try {
    const body = await request.json();
    const { refresh_token, logout_all_devices } = body;

    if (!refresh_token) {
      return errorResponse('AUTH_001', 'Refresh token required', 400);
    }

    // Get session from refresh token
    const session = await getSessionByRefreshToken(refresh_token);
    if (!session) {
      return errorResponse('AUTH_003', 'Invalid refresh token', 401);
    }

    let devicesAffected = 1;

    if (logout_all_devices) {
      // Delete all user sessions
      devicesAffected = await deleteAllUserSessions(session.user_id);
    } else {
      // Delete only current session
      await deleteSession(session.id);
    }

    return NextResponse.json({
      message: 'Logged out successfully',
      devices_affected: devicesAffected
    });

  } catch (error) {
    console.error('Logout error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}