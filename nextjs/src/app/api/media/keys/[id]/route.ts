import { NextRequest, NextResponse } from 'next/server';
import { vpnSubnetCheck, authCheck, errorResponse } from '@/lib/middleware';
import { checkVideoAccess, logMediaAccess } from '@/lib/media';
import fs from 'fs/promises';

// Helper function to get encryption key path based on environment
function getEncryptionKeyPath(): string {
  const isDevTesting = process.env.npm_lifecycle_event === 'dev:testing';
  if (isDevTesting) {
    return '../private/encryption.key';
  }
  return '/app/private/encryption.key';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  
  // Check VPN subnet
  const vpnCheckResult = await vpnSubnetCheck(request);
  if (vpnCheckResult) return vpnCheckResult;

  // Check authentication
  const authResult = await authCheck(request);
  if (authResult.response) return authResult.response;

  const user = authResult.user!;
  const { id: videoId } = await params;

  try {
    // Verify user has access to this video
    const hasAccess = await checkVideoAccess(user.userId, videoId);
    if (!hasAccess) {
      return errorResponse('MEDIA_001', 'Video not found or access denied', 403);
    }

    // Read encryption key (already in binary format)
    const keyPath = getEncryptionKeyPath();
    const keyBuffer = await fs.readFile(keyPath);

    // Log access
    const responseTime = Date.now() - startTime;
    const clientIP = request.headers.get('x-real-ip') || 
                     request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     '127.0.0.1';
    const userAgent = request.headers.get('user-agent') || '';
    
    await logMediaAccess(
      user.userId,
      user.sessionId,
      videoId,
      'key',
      clientIP,
      userAgent,
      responseTime,
      keyBuffer.length,
      200
    );

    // Return binary key data
    return new NextResponse(keyBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Length': keyBuffer.length.toString()
      }
    });

  } catch (error) {
    console.error('Key access error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}