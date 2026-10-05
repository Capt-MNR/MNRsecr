import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  login as loginRequest,
  loginWithProvider as loginWithProviderRequest,
  linkProvider as linkProviderRequest,
  logout as logoutRequest,
  restoreSession,
  setAuthSessionInvalidatedCallback,
  signup as signupRequest,
  unlinkProvider as unlinkProviderRequest,
  type AuthProvider,
  type AuthUser,
} from './auth';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithProvider: (provider: AuthProvider) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  linkProvider: (provider: AuthProvider, currentPassword: string) => Promise<void>;
  unlinkProvider: (provider: AuthProvider, currentPassword: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    setAuthSessionInvalidatedCallback(() => {
      setUser(null);
      queryClient.clear();
    });
    return () => setAuthSessionInvalidatedCallback(null);
  }, [queryClient]);

  useEffect(() => {
    void restoreSession().then(setUser).finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    login: async (email, password) => {
      const nextUser = await loginRequest(email, password);
      queryClient.clear();
      setUser(nextUser);
    },
    loginWithProvider: async (provider) => {
      const nextUser = await loginWithProviderRequest(provider);
      queryClient.clear();
      setUser(nextUser);
    },
    signup: async (email, password, name) => {
      const nextUser = await signupRequest(email, password, name);
      queryClient.clear();
      setUser(nextUser);
    },
    linkProvider: async (provider, currentPassword) => {
      await linkProviderRequest(provider, currentPassword);
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/oauth/linked'] });
    },
    unlinkProvider: async (provider, currentPassword) => {
      await unlinkProviderRequest(provider, currentPassword);
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/oauth/linked'] });
    },
    logout: async () => {
      try {
        await logoutRequest();
      } finally {
        queryClient.clear();
        setUser(null);
      }
    },
  }), [loading, queryClient, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}