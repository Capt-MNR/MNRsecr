import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import {
  login as loginRequest,
  logout as logoutRequest,
  restoreSession,
  signup as signupRequest,
  type AuthUser,
} from './auth';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void restoreSession().then(setUser).finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    login: async (email, password) => setUser(await loginRequest(email, password)),
    signup: async (email, password, name) => setUser(await signupRequest(email, password, name)),
    logout: async () => { await logoutRequest(); setUser(null); },
  }), [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}