import { NextRequest, NextResponse } from 'next/server';
import { vpnSubnetCheck, authCheck, errorResponse } from '@/lib/middleware';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  // Check VPN subnet
  const vpnCheckResult = await vpnSubnetCheck(request);
  if (vpnCheckResult) return vpnCheckResult;

  // Check authentication
  const authResult = await authCheck(request);
  if (authResult.response) return authResult.response;

  const user = authResult.user!;

  try {
    // Get all user sessions
    const result = await query(
      `SELECT 
        id, device_name, device_type, ip_address, 
        last_activity_at, created_at,
        CASE WHEN id = $2 THEN true ELSE false END as is_current
      FROM sessions 
      WHERE user_id = $1 AND expires_at > NOW()
      ORDER BY last_activity_at DESC`,
      [user.userId, user.sessionId]
    );

    const sessions = result.rows.map(session => ({
      id: session.id,
      device_name: session.device_name,
      device_type: session.device_type,
      ip_address: session.ip_address,
      last_activity: session.last_activity_at,
      is_current: session.is_current
    }));

    return NextResponse.json({ sessions });

  } catch (error) {
    console.error('Sessions error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}