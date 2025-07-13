import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken, validateSession, isIPAllowed, TokenPayload } from './auth';

export interface AuthRequest extends NextRequest {
  user?: {
    userId: string;
    email: string;
    role: string;
    sessionId: string;
  };
}

// VPN subnet check middleware
export async function vpnSubnetCheck(req: NextRequest): Promise<NextResponse | null> {
  const clientIP = req.headers.get('x-real-ip') || 
                   req.headers.get('x-forwarded-for')?.split(',')[0] || 
                   '127.0.0.1';
  
  console.log('VPN Check - Client IP:', clientIP);
  console.log('Headers:', {
    'x-real-ip': req.headers.get('x-real-ip'),
    'x-forwarded-for': req.headers.get('x-forwarded-for'),
  });
  
  if (!isIPAllowed(clientIP)) {
    return NextResponse.json(
      {
        error: {
          code: 'SEC_001',
          message: 'Access denied: VPN connection required'
        }
      },
      { status: 403 }
    );
  }
  
  return null;
}

// Authentication middleware
export async function authCheck(req: NextRequest): Promise<{ response?: NextResponse; user?: TokenPayload }> {
  const authHeader = req.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      response: NextResponse.json(
        {
          error: {
            code: 'AUTH_001',
            message: 'Authentication required'
          }
        },
        { status: 401 }
      )
    };
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const payload = verifyAccessToken(token);
    
    // Validate session
    const isValid = await validateSession(payload.sessionId);
    if (!isValid) {
      return {
        response: NextResponse.json(
          {
            error: {
              code: 'AUTH_004',
              message: 'Session expired'
            }
          },
          { status: 401 }
        )
      };
    }
    
    return { user: payload };
  } catch (error) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return {
        response: NextResponse.json(
          {
            error: {
              code: 'AUTH_002',
              message: 'Token has expired'
            }
          },
          { status: 401 }
        )
      };
    }
    
    return {
      response: NextResponse.json(
        {
          error: {
            code: 'AUTH_003',
            message: 'Invalid token'
          }
        },
        { status: 401 }
      )
    };
  }
}

// Error response helper
export function errorResponse(code: string, message: string, status: number = 500): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        timestamp: new Date().toISOString()
      }
    },
    { status }
  );
}