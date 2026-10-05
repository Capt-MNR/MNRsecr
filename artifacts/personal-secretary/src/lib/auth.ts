import { customFetch } from '@workspace/api-client-react';

export type AuthUser = {
  userId: string;
  tenantId: string;
  email: string;
};

export type AuthProvider = 'google' | 'microsoft';

type AuthResponse = {
  user: AuthUser;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

export async function beginOAuth(
  provider: AuthProvider,
  mode: 'login' | 'link',
  options: { currentPassword?: string; returnTo?: string } = {},
): Promise<string> {
  const returnTo = options.returnTo
    ?? `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const response = await customFetch<{ authorizationUrl: string }>('/api/auth/oauth/start', {
    method: 'POST',
    credentials: 'include',
    responseType: 'json',
    skipAuthRefresh: true,
    body: JSON.stringify({
      provider,
      mode,
      client: 'web',
      returnTo,
      ...(options.currentPassword ? { currentPassword: options.currentPassword } : {}),
    }),
  });
  return response.authorizationUrl;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await customFetch<{ user: AuthUser }>('/api/auth/me', {
      credentials: 'include',
      responseType: 'json',
    });
    return response.user;
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 401) return null;
    throw error;
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const response = await customFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    responseType: 'json',
    skipAuthRefresh: true,
    body: JSON.stringify({ email, password }),
  });
  return response.user;
}

export async function signup(email: string, password: string, name: string): Promise<AuthUser> {
  const response = await customFetch<AuthResponse>('/api/auth/signup', {
    method: 'POST',
    credentials: 'include',
    responseType: 'json',
    skipAuthRefresh: true,
    body: JSON.stringify({ email, password, ...(name.trim() ? { name: name.trim() } : {}) }),
  });
  return response.user;
}

export async function logout(): Promise<void> {
  await customFetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    responseType: 'json',
    skipAuthRefresh: true,
  }).catch(() => undefined);
}