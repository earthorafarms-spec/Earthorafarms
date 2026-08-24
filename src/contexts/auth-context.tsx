import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { syncUserProfile } from '@/lib/api';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const syncUser = useCallback((u: User) => {
    syncUserProfile({
      id: u.id,
      email: u.email ?? '',
      user_metadata: u.user_metadata as { name?: string } | undefined,
      email_confirmed_at: u.email_confirmed_at,
    }).catch(() => {});
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s }, error }) => {
      if (error) {
        supabase.auth.signOut().catch(() => {});
      }
      setSession(s);
      const u = s?.user ?? null;
      setUser(u);
      if (u) syncUser(u);
      setLoading(false);
    }).catch(() => {
      supabase.auth.signOut().catch(() => {});
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem('sb-' + (import.meta.env.VITE_SUPABASE_URL || '').split('//')[1]?.split('.')[0] + '-auth-token');
      }
      setSession(s);
      const u = s?.user ?? null;
      setUser(u);
      setLoading(false);
      if (event === 'SIGNED_IN' && u) syncUser(u);
    });

    return () => subscription.unsubscribe();
  }, [syncUser]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Supabase signOut error:', e);
    } finally {
      setUser(null);
      setSession(null);
      sessionStorage.removeItem('admin_authenticated');
      sessionStorage.removeItem('admin_password');
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
