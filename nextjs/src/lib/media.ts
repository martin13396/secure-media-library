import { query } from './db';
import crypto from 'crypto';
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

export interface MediaFile {
  id: string;
  original_name: string;
  file_type: 'image' | 'video';
  mime_type: string;
  file_size_bytes: number;
  width?: number;
  height?: number;
  duration_seconds?: number;
  favorite: boolean;
  storage_path: string;
  thumbnail_path?: string;
  preview_path?: string;
  created_at: Date;
  metadata?: Record<string, unknown>;
  encryption_key_id?: string;
}

// Get media library
export async function getMediaLibrary(
  type: 'all' | 'image' | 'video' | 'favorites' = 'all',
  page: number = 1,
  limit: number = 20,
  sort: 'created_at' | 'name' = 'created_at',
  order: 'asc' | 'desc' = 'desc'
): Promise<{ data: MediaFile[]; total: number }> {
  let whereClause = 'WHERE processing_status = \'completed\'';
  const params: unknown[] = [];
  
  if (type === 'favorites') {
    whereClause += ' AND favorite = true';
  } else if (type !== 'all') {
    whereClause += ' AND file_type = $1';
    params.push(type);
  }
  
  const offset = (page - 1) * limit;
  
  // Get total count
  const countQuery = `SELECT COUNT(*) FROM media_files ${whereClause}`;
  const countResult = await query(countQuery, params);
  const total = parseInt(countResult.rows[0].count);
  
  // Get paginated data
  const dataQuery = `
    SELECT 
      id, original_name, file_type, mime_type, file_size_bytes,
      width, height, duration_seconds, favorite, storage_path, 
      thumbnail_path, preview_path, created_at, metadata
    FROM media_files 
    ${whereClause}
    ORDER BY ${sort === 'name' ? 'original_name' : sort} ${order}
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  
  const dataResult = await query(dataQuery, [...params, limit, offset]);
  
  return {
    data: dataResult.rows,
    total
  };
}

// Get media by ID
export async function getMediaById(mediaId: string): Promise<MediaFile | null> {
  const result = await query(
    `SELECT 
      id, original_name, file_type, mime_type, file_size_bytes,
      width, height, duration_seconds, favorite, storage_path, 
      thumbnail_path, preview_path, created_at, metadata,
      encryption_key_id
    FROM media_files 
    WHERE id = $1 AND processing_status = 'completed'`,
    [mediaId]
  );
  
  return result.rows[0] || null;
}

// Get encryption key
export async function getEncryptionKey(keyId: string): Promise<{ key: string; iv: string } | null> {
  const result = await query(
    'SELECT key_value, iv_value FROM encryption_keys WHERE id = $1',
    [keyId]
  );
  
  if (result.rows.length === 0) return null;
  
  return {
    key: result.rows[0].key_value,
    iv: result.rows[0].iv_value
  };
}

// Decrypt file
export async function decryptFile(encryptedPath: string, key: string): Promise<Buffer> {
  const fullPath = getAssetPath(encryptedPath);
  console.log(`[DecryptFile] Reading file: ${fullPath}`);
  
  try {
    const encryptedData = await fs.readFile(fullPath);
    console.log(`[DecryptFile] Encrypted data size: ${encryptedData.length} bytes`);
    
    // Check if file is too small to be encrypted (needs at least IV + 1 block)
    if (encryptedData.length < 32) {
      console.error(`[DecryptFile] File too small to be encrypted: ${encryptedData.length} bytes`);
      // Return a minimal valid WebP as fallback
      // This is a 1x1 black pixel WebP
      return Buffer.from('RIFF$\x00\x00\x00WEBPVP8 \x18\x00\x00\x000\x01\x00\x9d\x01*\x01\x00\x01\x00\x01@%\xa4\x00\x03p\x00\xfe\xfb\x94\x00\x00', 'binary');
    }
    
    // Extract IV (first 16 bytes) and ciphertext
    const iv = encryptedData.slice(0, 16);
    const ciphertext = encryptedData.slice(16);
    console.log(`[DecryptFile] IV length: ${iv.length}, Ciphertext length: ${ciphertext.length}`);
    
    // Check if we have valid ciphertext
    if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
      console.error(`[DecryptFile] Invalid ciphertext length: ${ciphertext.length}`);
      // Return fallback WebP
      return Buffer.from('RIFF$\x00\x00\x00WEBPVP8 \x18\x00\x00\x000\x01\x00\x9d\x01*\x01\x00\x01\x00\x01@%\xa4\x00\x03p\x00\xfe\xfb\x94\x00\x00', 'binary');
    }
    
    // Decrypt
    const keyBuffer = Buffer.from(key, 'hex');
    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuffer, iv);
    
    let decrypted: Buffer;
    try {
      decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]);
    } catch (decryptError) {
      console.error(`[DecryptFile] Decryption failed:`, decryptError);
      // Check if this might be a placeholder encrypted with zeros IV
      const zeroIv = Buffer.alloc(16, 0);
      if (iv.equals(zeroIv)) {
        console.log(`[DecryptFile] Detected placeholder file with zero IV`);
        try {
          const placeholderDecipher = crypto.createDecipheriv('aes-128-cbc', keyBuffer, zeroIv);
          decrypted = Buffer.concat([
            placeholderDecipher.update(ciphertext),
            placeholderDecipher.final()
          ]);
        } catch {
          console.error(`[DecryptFile] Placeholder decryption also failed`);
          return Buffer.from('RIFF$\x00\x00\x00WEBPVP8 \x18\x00\x00\x000\x01\x00\x9d\x01*\x01\x00\x01\x00\x01@%\xa4\x00\x03p\x00\xfe\xfb\x94\x00\x00', 'binary');
        }
      } else {
        return Buffer.from('RIFF$\x00\x00\x00WEBPVP8 \x18\x00\x00\x000\x01\x00\x9d\x01*\x01\x00\x01\x00\x01@%\xa4\x00\x03p\x00\xfe\xfb\x94\x00\x00', 'binary');
      }
    }
    
    // Remove padding
    if (decrypted.length > 0) {
      const padLength = decrypted[decrypted.length - 1];
      if (padLength > 0 && padLength <= 16 && padLength <= decrypted.length) {
        decrypted = decrypted.slice(0, -padLength);
        console.log(`[DecryptFile] Decrypted size after padding removal: ${decrypted.length} bytes`);
      } else {
        console.warn(`[DecryptFile] Invalid padding length: ${padLength}`);
      }
    }
    
    // Validate that we have a valid WebP file
    if (decrypted.length > 12) {
      const riff = decrypted.slice(0, 4).toString('ascii');
      const webp = decrypted.slice(8, 12).toString('ascii');
      if (riff !== 'RIFF' || webp !== 'WEBP') {
        console.error(`[DecryptFile] Decrypted data is not a valid WebP file`);
        console.error(`[DecryptFile] Got headers: ${riff} / ${webp}`);
        // Return fallback
        return Buffer.from('RIFF$\x00\x00\x00WEBPVP8 \x18\x00\x00\x000\x01\x00\x9d\x01*\x01\x00\x01\x00\x01@%\xa4\x00\x03p\x00\xfe\xfb\x94\x00\x00', 'binary');
      }
    }
    
    return decrypted;
    
  } catch (error) {
    console.error(`[DecryptFile] Error reading or decrypting file:`, error);
    // Return fallback WebP
    return Buffer.from('RIFF$\x00\x00\x00WEBPVP8 \x18\x00\x00\x000\x01\x00\x9d\x01*\x01\x00\x01\x00\x01@%\xa4\x00\x03p\x00\xfe\xfb\x94\x00\x00', 'binary');
  }
}

// Log media access
export async function logMediaAccess(
  userId: string,
  sessionId: string,
  mediaFileId: string,
  action: string,
  ipAddress: string,
  userAgent: string,
  responseTime: number,
  bytesTransferred: number,
  statusCode: number
): Promise<void> {
  const vpnClientIp = ipAddress.startsWith('10.8.0.') ? ipAddress : '10.8.0.1';
  
  await query(
    `INSERT INTO access_logs (
      user_id, session_id, media_file_id, action,
      ip_address, vpn_client_ip, user_agent,
      response_time_ms, bytes_transferred, status_code
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      userId, sessionId, mediaFileId, action,
      ipAddress, vpnClientIp, userAgent,
      responseTime, bytesTransferred, statusCode
    ]
  );
}

// Check if user has access to video
export async function checkVideoAccess(userId: string, videoId: string): Promise<boolean> {
  // For now, all authenticated users have access to all videos
  // This can be extended to implement more granular permissions
  const media = await getMediaById(videoId);
  return media !== null && media.file_type === 'video';
}

// Toggle media favorite status
export async function toggleMediaFavorite(mediaId: string): Promise<{ id: string; favorite: boolean }> {
  const result = await query(
    `UPDATE media_files 
     SET favorite = NOT favorite 
     WHERE id = $1 
     RETURNING id, favorite`,
    [mediaId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Media file not found');
  }
  
  return result.rows[0];
}