'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api-client';
import Cookies from 'js-cookie';

interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  full_name: string;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  login: (username: string, password: string, deviceName?: string) => Promise<void>;
  logout: (logoutAllDevices?: boolean) => Promise<void>;
  refreshToken: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Token refresh is handled by api-client interceptor

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = async () => {
      const storedToken = Cookies.get('access_token');
      const storedRefreshToken = Cookies.get('refresh_token');
      
      if (storedToken && storedRefreshToken) {
        try {
          // Verify token by refreshing
          const response = await apiClient.post('/api/auth/refresh', {
            refresh_token: storedRefreshToken
          });
          
          setAccessToken(response.data.access_token);
          Cookies.set('access_token', response.data.access_token, { 
            expires: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
          });
          
          // Decode user from token
          const payload = JSON.parse(atob(response.data.access_token.split('.')[1]));
          setUser({
            id: payload.userId,
            email: payload.email,
            role: payload.role,
            username: payload.email.split('@')[0],
            full_name: ''
          });
        } catch {
          Cookies.remove('access_token');
          Cookies.remove('refresh_token');
        }
      }
      
      setIsLoading(false);
    };
    
    checkAuth();
  }, []);

  const login = async (username: string, password: string, deviceName?: string) => {
    const response = await apiClient.post('/api/auth/login', {
      username,
      password,
      device_name: deviceName || navigator.userAgent
    });
    
    const { access_token, refresh_token, user } = response.data;
    
    setAccessToken(access_token);
    setUser(user);
    
    Cookies.set('access_token', access_token, { 
      expires: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    });
    Cookies.set('refresh_token', refresh_token, { 
      expires: 7 // 7 days
    });
    
    router.push('/gallery');
  };

  const logout = async (logoutAllDevices = false) => {
    const refreshToken = Cookies.get('refresh_token');
    
    if (refreshToken) {
      try {
        await apiClient.post('/api/auth/logout', {
          refresh_token: refreshToken,
          logout_all_devices: logoutAllDevices
        });
      } catch {
        // Ignore logout errors
      }
    }
    
    setUser(null);
    setAccessToken(null);
    Cookies.remove('access_token');
    Cookies.remove('refresh_token');
    
    router.push('/login');
  };

  const refreshToken = async () => {
    const storedRefreshToken = Cookies.get('refresh_token');
    
    if (!storedRefreshToken) {
      throw new Error('No refresh token');
    }
    
    const response = await apiClient.post('/api/auth/refresh', {
      refresh_token: storedRefreshToken
    });
    
    const { access_token } = response.data;
    
    setAccessToken(access_token);
    Cookies.set('access_token', access_token, { 
      expires: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    });
  };

  return (
    <AuthContext.Provider value={{
      user,
      accessToken,
      login,
      logout,
      refreshToken,
      isLoading
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}