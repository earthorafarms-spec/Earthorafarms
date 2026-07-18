import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

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

  useEffect(() => {
    // 1. Seed session from storage immediately (avoids flash of unauthenticated UI)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const u = session.user;
        try {
          await (supabase.from("users") as any).upsert(
            {
              id: u.id,
              email: u.email ?? "",
              name: u.user_metadata?.name ?? u.email?.split("@")[0] ?? "",
              role: "customer",
              is_verified: u.email_confirmed_at != null,
            },
            { onConflict: "id" }
          );
        } catch (e) {
          console.error("Failed to sync user table on mount:", e);
        }
      }
      setLoading(false);
    });

    // 2. Keep state in sync with any auth event (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        // 3. Upsert public.users row on every SIGNED_IN so social logins
        //    also get a row without extra code in auth.tsx.
        if (_event === "SIGNED_IN" && session?.user) {
          const u = session.user;
          await (supabase.from("users") as any).upsert(
            {
              id: u.id,
              email: u.email ?? "",
              name: u.user_metadata?.name ?? u.email?.split("@")[0] ?? "",
              role: "customer",
              is_verified: u.email_confirmed_at != null,
            },
            { onConflict: "id" }
          );
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("Supabase signOut API error (handled):", e);
    } finally {
      setUser(null);
      setSession(null);
      sessionStorage.removeItem("admin_authenticated");
      sessionStorage.removeItem("admin_password");
      sessionStorage.removeItem("codex_authenticated");
      sessionStorage.removeItem("codex_password");
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
