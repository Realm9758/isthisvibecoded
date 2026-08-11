'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { ACCOUNT_POLICY_VERSION } from '@/lib/policy';
import type { Plan } from '@/lib/store';
import { apiPath } from '@/lib/site';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  plan: Plan;
  avatarColor: string | null;
  avatarUrl: string | null;
  bio: string | null;
  notifEmail: boolean;
  notifInApp: boolean;
  scansRemaining: number | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
    name: string,
    acceptedPolicyVersion: typeof ACCOUNT_POLICY_VERSION,
  ) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/api/auth/me'));
      const data = await res.json();
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshUser().finally(() => setLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshUser]);

  async function login(email: string, password: string) {
    const res = await fetch(apiPath('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Login failed');
    await refreshUser();
  }

  async function signup(
    email: string,
    password: string,
    name: string,
    acceptedPolicyVersion: typeof ACCOUNT_POLICY_VERSION,
  ) {
    if (acceptedPolicyVersion !== ACCOUNT_POLICY_VERSION) {
      throw new Error('Please accept the current account policy before signing up');
    }

    const res = await fetch(apiPath('/api/auth/signup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, policyVersion: acceptedPolicyVersion }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Signup failed');
    await refreshUser();
  }

  async function logout() {
    await fetch(apiPath('/api/auth/logout'), { method: 'POST' });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
