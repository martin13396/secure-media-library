import { NextRequest, NextResponse } from 'next/server';
import { authCheck } from '@/lib/middleware';

export async function GET(request: NextRequest) {
  // Test authentication without VPN check for debugging
  const authResult = await authCheck(request);
  if (authResult.response) return authResult.response;

  return NextResponse.json({
    message: 'Authentication successful',
    user: authResult.user,
    timestamp: new Date().toISOString()
  });
}