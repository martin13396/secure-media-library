import { NextRequest, NextResponse } from 'next/server';
import { vpnSubnetCheck, authCheck, errorResponse } from '@/lib/middleware';
import { getMediaById, getEncryptionKey, decryptFile, logMediaAccess } from '@/lib/media';

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
    if (!media || !media.preview_path) {
      return errorResponse('MEDIA_001', 'Preview not found', 404);
    }

    // Get encryption key
    if (!media.encryption_key_id) {
      return errorResponse('MEDIA_003', 'No encryption key ID found', 500);
    }
    
    const encryptionKey = await getEncryptionKey(media.encryption_key_id);
    if (!encryptionKey) {
      return errorResponse('MEDIA_003', 'Encryption key not found', 500);
    }

    // Decrypt preview
    const decryptedData = await decryptFile(media.preview_path, encryptionKey.key);

    // Log access
    const responseTime = Date.now() - startTime;
    const clientIP = request.headers.get('x-real-ip') || 
                     request.headers.get('x-forwarded-for')?.split(',')[0] || 
                     '127.0.0.1';
    const userAgent = request.headers.get('user-agent') || '';
    
    await logMediaAccess(
      user.userId,
      user.sessionId,
      mediaId,
      'preview',
      clientIP,
      userAgent,
      responseTime,
      decryptedData.length,
      200
    );

    // Return decrypted preview
    return new NextResponse(decryptedData, {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': decryptedData.length.toString()
      }
    });

  } catch (error) {
    console.error('Preview error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}