import { NextRequest, NextResponse } from 'next/server';
import { vpnSubnetCheck, authCheck, errorResponse } from '@/lib/middleware';
import { getMediaById, getEncryptionKey, decryptFile, logMediaAccess } from '@/lib/media';
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
  const mediaId = (await params).id;

  try {
    // Get media info
    const media = await getMediaById(mediaId);
    if (!media) {
      return errorResponse('MEDIA_001', 'Media not found', 404);
    }

    const clientIP = request.headers.get('x-real-ip') || 
                     request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     '127.0.0.1';
    const userAgent = request.headers.get('user-agent') || '';

    if (media.file_type === 'image') {
      // For images, decrypt and return the image data
      if (!media.encryption_key_id) {
        return errorResponse('MEDIA_003', 'No encryption key ID found', 500);
      }
      
      const encryptionKey = await getEncryptionKey(media.encryption_key_id);
      if (!encryptionKey) {
        return errorResponse('MEDIA_003', 'Encryption key not found', 500);
      }

      const decryptedData = await decryptFile(media.storage_path, encryptionKey.key);

      // Log access
      const responseTime = Date.now() - startTime;
      await logMediaAccess(
        user.userId,
        user.sessionId,
        mediaId,
        'stream',
        clientIP,
        userAgent,
        responseTime,
        decryptedData.length,
        200
      );

      return new NextResponse(decryptedData, {
        status: 200,
        headers: {
          'Content-Type': media.mime_type,
          'X-Encrypted': 'true',
          'Cache-Control': 'private, max-age=3600',
          'Content-Length': decryptedData.length.toString()
        }
      });
    } else {
      // For videos, return the HLS playlist with modified URLs
      const playlistPath = getAssetPath(media.storage_path);
      const playlistContent = await fs.readFile(playlistPath, 'utf8');
      
      // Get IV from metadata
      const iv = media.metadata?.iv || '';
      
      // Modify playlist to use our API endpoints
      const isDevTesting = process.env.npm_lifecycle_event === 'dev:testing';
      const baseUrl = isDevTesting ? 'http://localhost:3000' : (process.env.PUBLIC_BASE_URL || 'https://localhost:1027');
      
      const modifiedPlaylist = playlistContent
        .replace(
          /#EXT-X-KEY:METHOD=AES-128,URI="[^"]+"/g,
          `#EXT-X-KEY:METHOD=AES-128,URI="${baseUrl}/api/media/keys/${mediaId}",IV=0x${iv}`
        )
        .replace(
          /segment(\d+)\.ts/g,
          `${baseUrl}/api/media/segment/${mediaId}/$1`
        );

      // Log access
      const responseTime = Date.now() - startTime;
      await logMediaAccess(
        user.userId,
        user.sessionId,
        mediaId,
        'stream',
        clientIP,
        userAgent,
        responseTime,
        modifiedPlaylist.length,
        200
      );

      return new NextResponse(modifiedPlaylist, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
          'Content-Length': modifiedPlaylist.length.toString()
        }
      });
    }

  } catch (error) {
    console.error('Stream error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}