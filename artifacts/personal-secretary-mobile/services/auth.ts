import AsyncStorage from '@react-native-async-storage/async-storage';
import { customFetch, setAuthRefreshHandler, setAuthTokenGetter } from '@workspace/api-client-react';

export type AuthUser = {
  userId: string;
  tenantId: string;
  email: string;
};

type AuthResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

const ACCESS_KEY = '@personal-secretary-mobile/auth-access';
const REFRESH_KEY = '@personal-secretary-mobile/auth-refresh';
let accessToken: string | null = null;
let refreshToken: string | null = null;

setAuthTokenGetter(() => accessToken);

async function saveTokens(nextAccess: string, nextRefresh: string): Promise<void> {
  accessToken = nextAccess;
  refreshToken = nextRefresh;
  await Promise.all([
    AsyncStorage.setItem(ACCESS_KEY, nextAccess),
    AsyncStorage.setItem(REFRESH_KEY, nextRefresh),
  ]);
}

async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await Promise.all([
    AsyncStorage.removeItem(ACCESS_KEY),
    AsyncStorage.removeItem(REFRESH_KEY),
  ]);
}

export async function refreshSession(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const response = await customFetch<AuthResponse>('/api/auth/refresh', {
      method: 'POST',
      responseType: 'json',
      skipAuthRefresh: true,
      headers: { 'x-auth-transport': 'bearer' },
      body: JSON.stringify({ refreshToken }),
    });
    await saveTokens(response.accessToken, response.refreshToken);
    return true;
  } catch {
    await clearTokens();
    return false;
  }
}

setAuthRefreshHandler(refreshSession);

async function authenticate(path: '/api/auth/login' | '/api/auth/signup', body: Record<string, string>): Promise<AuthUser> {
  const response = await customFetch<AuthResponse>(path, {
    method: 'POST',
    responseType: 'json',
    skipAuthRefresh: true,
    headers: { 'x-auth-transport': 'bearer' },
    body: JSON.stringify(body),
  });
  await saveTokens(response.accessToken, response.refreshToken);
  return response.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  return authenticate('/api/auth/login', { email, password });
}

export async function signup(email: string, password: string, name: string): Promise<AuthUser> {
  return authenticate('/api/auth/signup', {
    email,
    password,
    ...(name.trim() ? { name: name.trim() } : {}),
  });
}

export async function restoreSession(): Promise<AuthUser | null> {
  accessToken = await AsyncStorage.getItem(ACCESS_KEY);
  refreshToken = await AsyncStorage.getItem(REFRESH_KEY);
  if (!accessToken && !(await refreshSession())) return null;
  try {
    return (await customFetch<{ user: AuthUser }>('/api/auth/me', {
      responseType: 'json',
      headers: { 'x-auth-transport': 'bearer' },
    })).user;
  } catch {
    if (!(await refreshSession())) return null;
    try {
      return (await customFetch<{ user: AuthUser }>('/api/auth/me', {
        responseType: 'json',
        headers: { 'x-auth-transport': 'bearer' },
      })).user;
    } catch {
      await clearTokens();
      return null;
    }
  }
}

export async function logout(): Promise<void> {
  try {
    await customFetch('/api/auth/logout', {
      method: 'POST',
      responseType: 'json',
      skipAuthRefresh: true,
      headers: { 'x-auth-transport': 'bearer' },
      body: JSON.stringify({ refreshToken }),
    });
  } finally {
    await clearTokens();
  }
}