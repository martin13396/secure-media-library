import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from './db';
import redis from './redis';

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-key';
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret-key';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const SESSION_TIMEOUT = 1800; // 30 minutes in seconds

export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: 'admin' | 'user';
  is_active: boolean;
}

export interface UserWithPassword extends User {
  password_hash: string;
}

export interface Session {
  id: string;
  user_id: string;
  device_id: string;
  device_name?: string;
  device_type?: string;
  ip_address: string;
  user_agent?: string;
  refresh_token_hash: string;
  expires_at: Date;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  sessionId: string;
}

// Generate device ID from user agent and IP
export function generateDeviceId(userAgent: string, ipAddress: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(`${userAgent}${ipAddress}`);
  return hash.digest('hex');
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const result = await bcrypt.compare(password, hash);
    return result;
  } catch (error) {
    console.error('Password verification failed:', error);
    return false;
  }
}

// Generate tokens
export function generateTokens(payload: TokenPayload) {
  const accessToken = jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });

  const refreshToken = jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });

  return { accessToken, refreshToken };
}

// Verify access token
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, ACCESS_TOKEN_SECRET) as TokenPayload;
}

// Verify refresh token
export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, REFRESH_TOKEN_SECRET) as TokenPayload;
}

// Get user by email or username
export async function getUserByCredentials(username: string): Promise<UserWithPassword | null> {
  try {
    const result = await query(
      'SELECT * FROM users WHERE (email = $1 OR username = $1) AND is_active = true',
      [username]
    );
    return result.rows[0] || null;
  } catch (error) {
    throw error;
  }
}

// Get user by ID
export async function getUserById(userId: string): Promise<User | null> {
  const result = await query(
    'SELECT * FROM users WHERE id = $1 AND is_active = true',
    [userId]
  );
  return result.rows[0] || null;
}

// Create session
export async function createSession(
  userId: string,
  deviceId: string,
  deviceName: string,
  ipAddress: string,
  userAgent: string,
  refreshToken: string
): Promise<Session> {
  const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const result = await query(
    `INSERT INTO sessions (
      user_id, device_id, device_name, device_type, 
      ip_address, user_agent, refresh_token_hash, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (user_id, device_id) 
    DO UPDATE SET 
      refresh_token_hash = $7,
      expires_at = $8,
      last_activity_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [userId, deviceId, deviceName.substring(0, 100), 'web', ipAddress, userAgent, refreshTokenHash, expiresAt]
  );

  const session = result.rows[0];

  // Store session in Redis
  await redis.setEx(
    `session:${session.id}`,
    SESSION_TIMEOUT,
    JSON.stringify({
      userId,
      deviceId,
      ipAddress,
    })
  );

  return session;
}

// Get session by refresh token
export async function getSessionByRefreshToken(refreshToken: string): Promise<Session | null> {
  const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  
  const result = await query(
    'SELECT * FROM sessions WHERE refresh_token_hash = $1 AND expires_at > NOW()',
    [refreshTokenHash]
  );
  
  return result.rows[0] || null;
}

// Update session activity
export async function updateSessionActivity(sessionId: string): Promise<void> {
  await query(
    'UPDATE sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1',
    [sessionId]
  );
  
  // Extend Redis session
  const sessionData = await redis.get(`session:${sessionId}`);
  if (sessionData) {
    await redis.setEx(`session:${sessionId}`, SESSION_TIMEOUT, sessionData);
  }
}

// Delete session
export async function deleteSession(sessionId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  await redis.del(`session:${sessionId}`);
}

// Delete all user sessions
export async function deleteAllUserSessions(userId: string): Promise<number> {
  const sessions = await query(
    'SELECT id FROM sessions WHERE user_id = $1',
    [userId]
  );
  
  // Delete from Redis
  for (const session of sessions.rows) {
    await redis.del(`session:${session.id}`);
  }
  
  const result = await query(
    'DELETE FROM sessions WHERE user_id = $1',
    [userId]
  );
  
  return result.rowCount || 0;
}

// Validate session
export async function validateSession(sessionId: string): Promise<boolean> {
  const sessionData = await redis.get(`session:${sessionId}`);
  if (!sessionData) {
    // Check database
    const result = await query(
      'SELECT * FROM sessions WHERE id = $1 AND expires_at > NOW()',
      [sessionId]
    );
    
    if (result.rows.length === 0) {
      return false;
    }
    
    // Re-cache in Redis
    const session = result.rows[0];
    await redis.setEx(
      `session:${sessionId}`,
      SESSION_TIMEOUT,
      JSON.stringify({
        userId: session.user_id,
        deviceId: session.device_id,
        ipAddress: session.ip_address,
      })
    );
  }
  
  return true;
}

// Check IP address is in allowed ranges
export function isIPAllowed(ip: string): boolean {
  const allowedRanges = [
    '127.0.0.1',
    '::1',
    '10.8.0.', // VPN subnet
    '192.168.1.', // Local network
    '172.16.', // Docker network
  ];
  
  return allowedRanges.some(range => ip.startsWith(range));
}