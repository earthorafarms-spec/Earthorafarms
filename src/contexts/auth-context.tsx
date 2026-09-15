import { createContext, useContext, type ReactNode } from 'react';

// The storefront runs as guest-only — no login/signup. Razorpay 1CC collects
// the customer email + shipping details at checkout, so we don't need a
// signed-in user object anywhere. This shim keeps `useAuth()` callable so
// existing code paths (cart-context, favorites, etc.) short-circuit cleanly
// on `user == null` instead of crashing.

export interface GuestUser {
  id: string;
  email: string | null;
  phone: string | null;
  user_metadata: { name?: string; full_name?: string };
}

interface AuthContextType {
  user: GuestUser | null;
  session: null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const GUEST_CONTEXT: AuthContextType = {
  user: null,
  session: null,
  loading: false,
  signOut: async () => {},
};

const AuthContext = createContext<AuthContextType>(GUEST_CONTEXT);

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={GUEST_CONTEXT}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  return useContext(AuthContext);
}
