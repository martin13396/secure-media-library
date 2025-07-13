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
  console.log(`[Thumbnail API] Request for media ID: ${mediaId}`);

  try {
    // Get media info
    const media = await getMediaById(mediaId);
    console.log(`[Thumbnail API] Media found:`, media);
    if (!media) {
      return errorResponse('MEDIA_001', 'Media not found', 404);
    }

    // Get encryption key
    if (!media.encryption_key_id) {
      return errorResponse('MEDIA_003', 'No encryption key ID found', 500);
    }
    
    const encryptionKey = await getEncryptionKey(media.encryption_key_id);
    console.log(`[Thumbnail API] Encryption key found:`, !!encryptionKey);
    if (!encryptionKey) {
      return errorResponse('MEDIA_003', 'Encryption key not found', 500);
    }

    // Use thumbnail path if available, otherwise use main image as fallback
    const pathToDecrypt = media.thumbnail_path || media.storage_path;
    console.log(`[Thumbnail API] Path to decrypt: ${pathToDecrypt}`);
    
    // Decrypt the file (thumbnail or main image)
    const decryptedData = await decryptFile(pathToDecrypt, encryptionKey.key);
    console.log(`[Thumbnail API] Decrypted data size: ${decryptedData.length} bytes`);

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
      'thumbnail',
      clientIP,
      userAgent,
      responseTime,
      decryptedData.length,
      200
    );

    // Return decrypted thumbnail
    return new NextResponse(decryptedData, {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': decryptedData.length.toString()
      }
    });

  } catch (error) {
    console.error('Thumbnail error:', error);
    return errorResponse('SYSTEM_001', 'Internal server error', 500);
  }
}