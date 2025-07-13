import { NextRequest, NextResponse } from 'next/server';
import { vpnSubnetCheck, authCheck, errorResponse } from '@/lib/middleware';
import { deleteSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Check VPN subnet
  const vpnCheckResult = await vpnSubnetCheck(request);
  if (vpnCheckResult) return vpnCheckResult;

  // Check authentication
  const authResult = await authCheck(request);
  if (authResult.response) return authResult.response;

  const user = authResult.user!;
  const sessionId = (await params).id;

  try {
    // Verify session belongs to user
    const result = await query(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [sessionId, user.userId]
    );

    if (result.rows.length === 0) {
      return errorResponse('AUTH_004', 'Session not found', 404);
    }

    // Don't allow deleting current session
    if (sessionId === user.sessionId) {
      return errorResponse('AUTH_005', 'Cannot delete current session', 400);
    }

    // Delete session
    await deleteSession(sessionId);

    return NextResponse.json({
      message: 'Session terminated successfully'
    });

  } catch (error) {
    console.error('Session delete error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}