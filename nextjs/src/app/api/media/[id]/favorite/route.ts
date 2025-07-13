import { NextRequest, NextResponse } from 'next/server';
import { vpnSubnetCheck, authCheck, errorResponse } from '@/lib/middleware';
import { toggleMediaFavorite, getMediaById } from '@/lib/media';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Check VPN subnet
  const vpnCheckResult = await vpnSubnetCheck(request);
  if (vpnCheckResult) return vpnCheckResult;

  // Check authentication
  const authResult = await authCheck(request);
  if (authResult.response) return authResult.response;

  try {
    const { id: mediaId } = await params;
    
    // Check if media exists
    const media = await getMediaById(mediaId);
    if (!media) {
      return errorResponse('MEDIA_001', 'Media file not found', 404);
    }

    // Toggle favorite status
    const updatedMedia = await toggleMediaFavorite(mediaId);
    
    return NextResponse.json({
      id: updatedMedia.id,
      favorite: updatedMedia.favorite
    });
    
  } catch (error) {
    console.error('Toggle favorite error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}