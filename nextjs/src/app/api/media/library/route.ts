import { NextRequest, NextResponse } from 'next/server';
import { vpnSubnetCheck, authCheck, errorResponse } from '@/lib/middleware';
import { getMediaLibrary } from '@/lib/media';

export async function GET(request: NextRequest) {
  // Check VPN subnet
  const vpnCheckResult = await vpnSubnetCheck(request);
  if (vpnCheckResult) return vpnCheckResult;

  // Check authentication
  const authResult = await authCheck(request);
  if (authResult.response) return authResult.response;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as 'all' | 'image' | 'video' | 'favorites' || 'all';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const sort = searchParams.get('sort') as 'created_at' | 'name' || 'created_at';
    const order = searchParams.get('order') as 'asc' | 'desc' || 'desc';

    // Validate parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return errorResponse('MEDIA_001', 'Invalid pagination parameters', 400);
    }

    const { data, total } = await getMediaLibrary(type, page, limit, sort, order);

    // Transform data to include URLs
    const transformedData = data.map(item => ({
      id: item.id,
      name: item.original_name,
      type: item.file_type,
      favorite: item.favorite,
      thumbnail_url: `/api/media/thumbnail/${item.id}`,
      preview_url: item.preview_path ? `/api/media/preview/${item.id}` : null,
      created_at: item.created_at,
      metadata: {
        width: item.width,
        height: item.height,
        duration: item.duration_seconds,
        size_bytes: item.file_size_bytes
      }
    }));

    return NextResponse.json({
      data: transformedData,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Media library error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}