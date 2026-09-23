import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { customFetch, setAuthRefreshHandler, setAuthTokenGetter } from '@workspace/api-client-react';
import { disconnectSecretaryPush } from './mobile-push';

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
const SECURE_ACCESS_KEY = 'personal-secretary-mobile.auth-access';
const SECURE_REFRESH_KEY = 'personal-secretary-mobile.auth-refresh';
let accessToken: string | null = null;
let refreshToken: string | null = null;

setAuthTokenGetter(() => accessToken);

async function saveTokens(nextAccess: string, nextRefresh: string): Promise<void> {
  accessToken = nextAccess;
  refreshToken = nextRefresh;
  await Promise.all([
    SecureStore.setItemAsync(SECURE_ACCESS_KEY, nextAccess),
    SecureStore.setItemAsync(SECURE_REFRESH_KEY, nextRefresh),
  ]);
  await Promise.all([
    AsyncStorage.removeItem(ACCESS_KEY),
    AsyncStorage.removeItem(REFRESH_KEY),
  ]);
}

async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await Promise.all([
    SecureStore.deleteItemAsync(SECURE_ACCESS_KEY),
    SecureStore.deleteItemAsync(SECURE_REFRESH_KEY),
    AsyncStorage.removeItem(ACCESS_KEY),
    AsyncStorage.removeItem(REFRESH_KEY),
  ]);
}

async function readToken(secureKey: string, legacyKey: string): Promise<string | null> {
  const secure = await SecureStore.getItemAsync(secureKey).catch(() => null);
  if (secure) {
    await AsyncStorage.removeItem(legacyKey);
    return secure;
  }
  const legacy = await AsyncStorage.getItem(legacyKey);
  if (!legacy) return null;
  try {
    await SecureStore.setItemAsync(secureKey, legacy);
    await AsyncStorage.removeItem(legacyKey);
  } catch {
    // Preserve the current session if secure storage is temporarily unavailable.
    // The next restore retries migration before any new token is persisted.
  }
  return legacy;
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
  accessToken = await readToken(SECURE_ACCESS_KEY, ACCESS_KEY);
  refreshToken = await readToken(SECURE_REFRESH_KEY, REFRESH_KEY);
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
    await disconnectSecretaryPush();
    await clearTokens();
  }
}