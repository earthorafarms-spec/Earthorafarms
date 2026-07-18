import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import type { User } from '@supabase/supabase-js';
import ScrollToTop from './components/ScrollToTop';
import { supabase } from './lib/supabase';

const queryClient = new QueryClient();

const ChatWidget = lazy(() => import('./components/chat/ChatWidget').then((module) => ({ default: module.ChatWidget })));
const Home = lazy(() => import('./pages/home'));
const Recipes = lazy(() => import('./pages/recipes'));
const Contact = lazy(() => import('./pages/contact'));
const HealthBenefits = lazy(() => import('./pages/health-benefits'));
const Gallery = lazy(() => import('./pages/gallery'));
const Auth = lazy(() => import('./pages/auth'));
const Products = lazy(() => import('./pages/products'));
const Cart = lazy(() => import('./pages/cart'));
const AdminLayout = lazy(() => import('./pages/admin/layout'));
const AdminDashboard = lazy(() => import('./pages/admin/dashboard'));
const AdminProducts = lazy(() => import('./pages/admin/products'));
const AdminOrders = lazy(() => import('./pages/admin/orders'));
const AdminAnalytics = lazy(() => import('./pages/admin/analytics'));
const AdminCoupons = lazy(() => import('./pages/admin/coupons'));
const AdminChat = lazy(() => import('./pages/admin/chat'));

const CodexLayout = lazy(() => import('./pages/codex/layout'));
const CodexDashboard = lazy(() => import('./pages/codex/dashboard'));
const CodexAnalytics = lazy(() => import('./pages/codex/analytics'));
const CodexReports = lazy(() => import('./pages/codex/reports'));
const CodexSettings = lazy(() => import('./pages/codex/settings'));
const CodexChat = lazy(() => import('./pages/codex/chat'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="text-sm text-foreground/50">Loading...</div>
    </div>
  );
}

function hasAdminRole(user: User | null) {
  if (!user) return false;
  const role = user.app_metadata?.role;
  const roles = user.app_metadata?.roles;
  return role === "admin" || user.app_metadata?.admin === true || (Array.isArray(roles) && roles.includes("admin"));
}

function AdminGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUser(data.user);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setPassword("");
      return;
    }

    if (!hasAdminRole(data.user)) {
      await supabase.auth.signOut();
      setError("This account is not authorized for the admin portal.");
      setPassword("");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1b4332] text-white font-sans">
        <div className="text-sm text-white/70">Checking admin session...</div>
      </div>
    );
  }

  if (hasAdminRole(user)) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1b4332] relative overflow-hidden font-sans px-4">
      {/* Background decorations */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04)_0,transparent_100%)] pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/5 rounded-full filter blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/10 rounded-full filter blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-3xl p-8 md:p-10 shadow-2xl relative z-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-6 shadow-lg shadow-accent/20">
          <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        
        <h2 className="text-2xl md:text-3xl font-serif text-white mb-2">Admin Portal</h2>
        <p className="text-sm text-white/60 mb-8 font-light">Sign in with an authorized admin account to proceed</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1 text-left">
            <input
              type="email"
              placeholder="Admin email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full h-13 px-4 rounded-xl bg-white/5 border text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-accent transition-all ${
                error ? "border-red-500/50 focus:ring-red-500/50" : "border-white/10"
              }`}
              autoComplete="email"
              autoFocus
            />
          </div>
          <div className="space-y-1 text-left">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full h-13 px-4 rounded-xl bg-white/5 border text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-accent transition-all ${
                error ? "border-red-500/50 focus:ring-red-500/50" : "border-white/10"
              }`}
              autoComplete="current-password"
            />
            {error && (
              <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1 font-medium px-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={!email.trim() || !password}
            className="w-full h-13 bg-accent text-primary font-bold rounded-xl hover:bg-accent/90 transition-all shadow-md shadow-accent/10 active:scale-[0.98] mt-2 text-sm uppercase tracking-wider"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

function CodexGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem("codex_authenticated") === "true";
  });
  const [step, setStep] = useState<"password" | "otp">("password");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [resent, setResent] = useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    setErrorMsg("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("send-otp", {
        body: { password, domain: "codex" },
      });
      if (fnError) throw fnError;
      if (data?.ok) {
        sessionStorage.setItem("codex_password", password);
        setStep("otp");
        setResent(false);
      } else {
        setError(true);
        setErrorMsg(data?.error || "Incorrect password");
        setPassword("");
      }
    } catch {
      setError(true);
      setErrorMsg("Connection error. Please try again.");
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    setErrorMsg("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("verify-otp", {
        body: { otp, domain: "codex" },
      });
      if (fnError) throw fnError;
      if (data?.ok) {
        sessionStorage.setItem("codex_authenticated", "true");
        setIsAuthenticated(true);
      } else {
        setError(true);
        setErrorMsg(data?.error || "Invalid OTP");
        setOtp("");
      }
    } catch {
      setError(true);
      setErrorMsg("Verification failed. Please try again.");
      setOtp("");
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    setLoading(true);
    setError(false);
    setErrorMsg("");
    setResent(true);
    try {
      const pwd = sessionStorage.getItem("codex_password") || password;
      await supabase.functions.invoke("send-otp", {
        body: { password: pwd, domain: "codex" },
      });
    } catch {
      setErrorMsg("Failed to resend OTP");
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated) {
    return <>{children}</>;
  }

  const cls = "w-full h-12 px-4 text-sm bg-[#fafaf8] border border-border/40 rounded-xl outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/5 transition-all text-center placeholder:text-foreground/30 font-mono font-medium";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf8] p-6 font-mono">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-border/40 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
        <div className="flex flex-col items-center gap-3.5 mb-6">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
            {step === "password" ? (
              <svg className="w-5.5 h-5.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : (
              <svg className="w-5.5 h-5.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
              </svg>
            )}
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold text-foreground">Codex Console</h2>
            <p className="text-xs text-foreground/45 mt-0.5">
              {step === "password" ? "Enter your developer key" : "Enter the OTP sent to your email"}
            </p>
          </div>
        </div>

        {step === "password" ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                placeholder="Developer Key"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className={cls}
              />
              {error && errorMsg && (
                <p className="text-xs text-red-400 mt-1.5 text-center font-medium">{errorMsg}</p>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-primary text-primary-foreground font-semibold text-sm rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Decrypting…" : "Initialize Terminal"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                inputMode="numeric"
                placeholder="000000"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={loading}
                className={`${cls} text-2xl font-bold tracking-[0.4em] font-mono`}
              />
              {error && errorMsg && (
                <p className="text-xs text-red-400 mt-1.5 text-center font-medium">{errorMsg}</p>
              )}
              {resent && !error && (
                <p className="text-xs text-green-600 mt-1.5 text-center font-medium">OTP resent successfully</p>
              )}
            </div>
            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full h-12 bg-primary text-primary-foreground font-semibold text-sm rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Verifying OTP…" : "Confirm OTP"}
            </button>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => { setStep("password"); setError(false); setErrorMsg(""); setOtp(""); }}
                className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={resendOtp}
                disabled={loading}
                className="text-xs text-primary hover:text-primary/70 transition-colors disabled:opacity-40"
              >
                Resend OTP
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <ScrollToTop />
        <Suspense fallback={<PageLoader />}>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/recipes" component={Recipes} />
            <Route path="/contact" component={Contact} />
            <Route path="/health-benefits" component={HealthBenefits} />
            <Route path="/gallery" component={Gallery} />
            <Route path="/our-product" component={Products} />
            <Route path="/cart" component={Cart} />
            <Route path="/auth" component={Auth} />
            <Route path="/admin"><Redirect to="/admin/dashboard" /></Route>
            <Route path="/admin/:rest*">
              {() => (
                <AdminGate>
                  <AdminLayout>
                    <Switch>
                      <Route path="/admin/dashboard"><AdminDashboard /></Route>
                      <Route path="/admin/products"><AdminProducts /></Route>
                      <Route path="/admin/orders"><AdminOrders /></Route>
                      <Route path="/admin/coupons"><AdminCoupons /></Route>
                      <Route path="/admin/chat"><AdminChat /></Route>
                      <Route path="/admin/analytics"><AdminAnalytics /></Route>
                      <Route><Redirect to="/admin/dashboard" /></Route>
                    </Switch>
                  </AdminLayout>
                </AdminGate>
              )}
            </Route>
            <Route path="/codex"><Redirect to="/codex/dashboard" /></Route>
            <Route path="/codex/:rest*">
              {() => (
                <CodexGate>
                  <CodexLayout>
                    <Switch>
                      <Route path="/codex/dashboard"><CodexDashboard /></Route>
                      <Route path="/codex/analytics"><CodexAnalytics /></Route>
                      <Route path="/codex/reports"><CodexReports /></Route>
                      <Route path="/codex/chat"><CodexChat /></Route>
                      <Route path="/codex/settings"><CodexSettings /></Route>
                      <Route><Redirect to="/codex/dashboard" /></Route>
                    </Switch>
                  </CodexLayout>
                </CodexGate>
              )}
            </Route>
            <Route>
              <div className="flex h-screen items-center justify-center bg-background">
                <h1 className="text-2xl text-primary font-serif">Page not found</h1>
              </div>
            </Route>
          </Switch>
        </Suspense>
      </WouterRouter>
      <Suspense fallback={null}>
        <ChatWidget />
      </Suspense>
    </QueryClientProvider>
  );
}

export default App;
