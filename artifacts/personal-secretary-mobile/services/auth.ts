import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  customFetch,
  setAuthRefreshHandler,
  setAuthTokenGetter,
} from '@workspace/api-client-react';
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
const DEVELOPMENT_AUTH_SENTINEL = 'dev-user';
const ACCOUNT_STORAGE_KEYS = new Set([
  '@personal-secretary-mobile/messages',
  '@personal-secretary-mobile/conversation',
]);
const ACCOUNT_STORAGE_PREFIXES = [
  '@personal-secretary-mobile/approval-draft/',
  '@personal-secretary-mobile/input-asset/',
];
const DEVELOPMENT_AUTH_ENABLED = process.env.NODE_ENV !== 'production'
  && process.env.EXPO_PUBLIC_MOBILE_AUTH_MODE === 'development';
const DEVELOPMENT_AUTH_USER: AuthUser = {
  userId: 'development-identity',
  tenantId: 'development-identity',
  email: 'development identity',
};
let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let authSessionInvalidatedHandler: (() => void | Promise<void>) | null = null;

export function isDevelopmentAuthEnabled(): boolean {
  return DEVELOPMENT_AUTH_ENABLED;
}

export function setAuthSessionInvalidatedCallback(
  handler: (() => void | Promise<void>) | null,
): void {
  authSessionInvalidatedHandler = handler;
}

setAuthTokenGetter(() => DEVELOPMENT_AUTH_ENABLED ? DEVELOPMENT_AUTH_SENTINEL : accessToken);

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
    ...(Platform.OS === 'web'
      ? []
      : [
        SecureStore.deleteItemAsync(SECURE_ACCESS_KEY),
        SecureStore.deleteItemAsync(SECURE_REFRESH_KEY),
      ]),
    AsyncStorage.removeItem(ACCESS_KEY),
    AsyncStorage.removeItem(REFRESH_KEY),
  ]);
}

async function clearPersistedAccountState(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys().catch(() => []);
  const accountKeys = keys.filter((key) =>
    ACCOUNT_STORAGE_KEYS.has(key)
    || ACCOUNT_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
  if (accountKeys.length > 0) {
    await AsyncStorage.multiRemove(accountKeys);
  }
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

async function invalidateSession(): Promise<void> {
  await clearTokens();
  await clearPersistedAccountState();
  await authSessionInvalidatedHandler?.();
}

async function refreshSessionOnce(): Promise<boolean> {
  if (DEVELOPMENT_AUTH_ENABLED) return false;
  if (!refreshToken) {
    await invalidateSession();
    return false;
  }
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
    await invalidateSession();
    return false;
  }
}

export async function refreshSession(): Promise<boolean> {
  refreshPromise ??= refreshSessionOnce().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
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
  await clearPersistedAccountState();
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
  if (DEVELOPMENT_AUTH_ENABLED) {
    accessToken = DEVELOPMENT_AUTH_SENTINEL;
    refreshToken = null;
    try {
      // This endpoint is protected by the backend's existing development
      // identity adapter. It avoids inventing a client-side identity.
      await customFetch('/api/records', {
        responseType: 'json',
        skipAuthRefresh: true,
      });
      return DEVELOPMENT_AUTH_USER;
    } catch {
      accessToken = null;
      return null;
    }
  }
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
    if (!DEVELOPMENT_AUTH_ENABLED) {
      await customFetch('/api/auth/logout', {
        method: 'POST',
        responseType: 'json',
        skipAuthRefresh: true,
        headers: { 'x-auth-transport': 'bearer' },
        body: JSON.stringify({ refreshToken }),
      });
    }
  } finally {
    try {
      await disconnectSecretaryPush();
    } finally {
      await clearTokens();
      await clearPersistedAccountState();
    }
  }
}