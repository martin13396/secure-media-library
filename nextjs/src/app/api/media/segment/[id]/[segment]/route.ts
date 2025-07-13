import { NextRequest, NextResponse } from 'next/server';
import { vpnSubnetCheck, authCheck, errorResponse } from '@/lib/middleware';
import { getMediaById, checkVideoAccess, logMediaAccess } from '@/lib/media';
import fs from 'fs/promises';
import path from 'path';

// Helper function to construct file paths based on environment
function getAssetPath(relativePath: string): string {
  const isDevTesting = process.env.npm_lifecycle_event === 'dev:testing';
  if (isDevTesting) {
    return path.join('../assets', relativePath);
  }
  return path.join('/app/assets', relativePath);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; segment: string }> }
) {
  const startTime = Date.now();
  
  // Check VPN subnet
  const vpnCheckResult = await vpnSubnetCheck(request);
  if (vpnCheckResult) return vpnCheckResult;

  // Check authentication
  const authResult = await authCheck(request);
  if (authResult.response) return authResult.response;

  const user = authResult.user!;
  const { id: videoId, segment: segmentNumber } = await params;

  try {
    // Verify user has access to this video
    const hasAccess = await checkVideoAccess(user.userId, videoId);
    if (!hasAccess) {
      return errorResponse('MEDIA_001', 'Video not found or access denied', 403);
    }

    // Get media info
    const media = await getMediaById(videoId);
    if (!media || media.file_type !== 'video') {
      return errorResponse('MEDIA_001', 'Video not found', 404);
    }

    // Construct segment path
    const videoDir = path.dirname(media.storage_path);
    const segmentPath = getAssetPath(path.join(videoDir, `segment${segmentNumber.padStart(3, '0')}.ts`));

    // Check if segment exists
    try {
      await fs.access(segmentPath);
    } catch {
      return errorResponse('MEDIA_001', 'Segment not found', 404);
    }

    // Read encrypted segment
    const segmentData = await fs.readFile(segmentPath);

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
      'segment',
      clientIP,
      userAgent,
      responseTime,
      segmentData.length,
      200
    );

    // Return encrypted segment (HLS player will decrypt using the key)
    return new NextResponse(segmentData, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp2t',
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': segmentData.length.toString()
      }
    });

  } catch (error) {
    console.error('Segment error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}