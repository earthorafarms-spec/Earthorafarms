import { lazy, Suspense, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { CartProvider } from '@/contexts/cart-context';
import { AuthProvider } from '@/contexts/auth-context';
import { trackPageView } from '@/lib/analytics';
import ScrollToTop from '@/components/ScrollToTop';
import { ChatWidget } from '@/components/chat/ChatWidget';

// ── Public pages ──────────────────────────────────────────────────────────────
const Home = lazy(() => import('./pages/home'));
const Recipes = lazy(() => import('./pages/recipes'));
const Contact = lazy(() => import('./pages/contact'));
const HealthBenefits = lazy(() => import('./pages/health-benefits'));
const Gallery = lazy(() => import('./pages/gallery'));
const Auth = lazy(() => import('./pages/auth'));
const Products = lazy(() => import('./pages/products'));
const Cart = lazy(() => import('./pages/cart'));
const Checkout = lazy(() => import('./pages/checkout'));

// ── Admin pages ───────────────────────────────────────────────────────────────
const AdminLayout = lazy(() => import('./pages/admin-earthora/layout'));
const AdminDashboard = lazy(() => import('./pages/admin-earthora/dashboard'));
const AdminProducts = lazy(() => import('./pages/admin-earthora/products'));
const AdminOrders = lazy(() => import('./pages/admin-earthora/orders'));
const AdminAnalytics = lazy(() => import('./pages/admin-earthora/analytics'));
const AdminCoupons = lazy(() => import('./pages/admin-earthora/coupons'));
const AdminFestive = lazy(() => import('./pages/admin-earthora/festive'));
const AdminSettings = lazy(() => import('./pages/admin-earthora/settings'));

// ── Codex pages ───────────────────────────────────────────────────────────────
const CodexLayout = lazy(() => import('./pages/codex/layout'));
const CodexDashboard = lazy(() => import('./pages/codex/dashboard'));
const CodexAnalytics = lazy(() => import('./pages/codex/analytics'));
const CodexReports = lazy(() => import('./pages/codex/reports'));
const CodexSettings = lazy(() => import('./pages/codex/settings'));

// ── Query client ──────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// ── Loaders ───────────────────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

// ── Admin Gate (password + OTP) ───────────────────────────────────────────────
function AdminGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    sessionStorage.getItem("admin_authenticated") === "true"
  );
  const [step, setStep] = useState<"password" | "otp">("password");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [resent, setResent] = useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(false); setErrorMsg("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("send-otp", {
        body: { password, domain: "admin" },
      });
      if (fnError) throw fnError;
      if (data?.ok) {
        sessionStorage.setItem("admin_password", password);
        setStep("otp"); setResent(false);
      } else {
        setError(true); setErrorMsg(data?.error || "Incorrect password"); setPassword("");
      }
    } catch {
      setError(true); setErrorMsg("Connection error. Please try again."); setPassword("");
    } finally { setLoading(false); }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(false); setErrorMsg("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("verify-otp", {
        body: { otp, domain: "admin" },
      });
      if (fnError) throw fnError;
      if (data?.ok) {
        sessionStorage.setItem("admin_authenticated", "true");
        setIsAuthenticated(true);
      } else {
        setError(true); setErrorMsg(data?.error || "Invalid OTP"); setOtp("");
      }
    } catch {
      setError(true); setErrorMsg("Verification failed. Please try again."); setOtp("");
    } finally { setLoading(false); }
  };

  const resendOtp = async () => {
    setLoading(true); setError(false); setErrorMsg(""); setResent(true);
    try {
      const pwd = sessionStorage.getItem("admin_password") || password;
      await supabase.functions.invoke("send-otp", { body: { password: pwd, domain: "admin" } });
    } catch { setErrorMsg("Failed to resend OTP"); }
    finally { setLoading(false); }
  };

  if (isAuthenticated) return <>{children}</>;

  const inputClass = "w-full h-12 px-4 text-sm bg-[#fafaf8] border border-border/40 rounded-xl outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/5 transition-all text-center placeholder:text-foreground/30 font-medium tracking-wider";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf8] p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-border/40 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
        <div className="flex flex-col items-center gap-3.5 mb-6">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
            {step === "password" ? (
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )}
          </div>
          <div className="text-center">
            <h2 className="text-lg font-serif font-bold text-foreground">Admin Portal</h2>
            <p className="text-xs text-foreground/45 mt-0.5">
              {step === "password" ? "Enter your security password" : "Enter the OTP sent to your email"}
            </p>
          </div>
        </div>

        {step === "password" ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <input type="password" placeholder="Security Password" value={password}
                onChange={(e) => setPassword(e.target.value)} disabled={loading} className={inputClass} />
              {error && errorMsg && <p className="text-xs text-red-400 mt-1.5 text-center font-medium">{errorMsg}</p>}
            </div>
            <button type="submit" disabled={loading}
              className="w-full h-12 bg-primary text-primary-foreground font-semibold text-sm rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] mt-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? "Verifying…" : "Authenticate"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div>
              <input type="text" inputMode="numeric" placeholder="000000" maxLength={6} value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={loading}
                className={`${inputClass} text-2xl font-bold tracking-[0.4em]`} />
              {error && errorMsg && <p className="text-xs text-red-400 mt-1.5 text-center font-medium">{errorMsg}</p>}
              {resent && !error && <p className="text-xs text-green-600 mt-1.5 text-center font-medium">OTP resent successfully</p>}
            </div>
            <button type="submit" disabled={loading || otp.length !== 6}
              className="w-full h-12 bg-primary text-primary-foreground font-semibold text-sm rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] mt-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? "Verifying OTP…" : "Confirm OTP"}
            </button>
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={() => { setStep("password"); setError(false); setErrorMsg(""); setOtp(""); }}
                className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors">Back</button>
              <button type="button" onClick={resendOtp} disabled={loading}
                className="text-xs text-primary hover:text-primary/70 transition-colors disabled:opacity-40">Resend OTP</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Codex Gate (password + OTP) ───────────────────────────────────────────────
function CodexGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    sessionStorage.getItem("codex_authenticated") === "true"
  );
  const [step, setStep] = useState<"password" | "otp">("password");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [resent, setResent] = useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(false); setErrorMsg("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("send-otp", {
        body: { password, domain: "codex" },
      });
      if (fnError) throw fnError;
      if (data?.ok) {
        sessionStorage.setItem("codex_password", password);
        setStep("otp"); setResent(false);
      } else {
        setError(true); setErrorMsg(data?.error || "Incorrect password"); setPassword("");
      }
    } catch {
      setError(true); setErrorMsg("Connection error. Please try again."); setPassword("");
    } finally { setLoading(false); }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(false); setErrorMsg("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("verify-otp", {
        body: { otp, domain: "codex" },
      });
      if (fnError) throw fnError;
      if (data?.ok) {
        sessionStorage.setItem("codex_authenticated", "true");
        setIsAuthenticated(true);
      } else {
        setError(true); setErrorMsg(data?.error || "Invalid OTP"); setOtp("");
      }
    } catch {
      setError(true); setErrorMsg("Verification failed. Please try again."); setOtp("");
    } finally { setLoading(false); }
  };

  const resendOtp = async () => {
    setLoading(true); setError(false); setErrorMsg(""); setResent(true);
    try {
      const pwd = sessionStorage.getItem("codex_password") || password;
      await supabase.functions.invoke("send-otp", { body: { password: pwd, domain: "codex" } });
    } catch { setErrorMsg("Failed to resend OTP"); }
    finally { setLoading(false); }
  };

  if (isAuthenticated) return <>{children}</>;

  const cls = "w-full h-12 px-4 text-sm bg-[#fafaf8] border border-border/40 rounded-xl outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/5 transition-all text-center placeholder:text-foreground/30 font-mono font-medium";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf8] p-6 font-mono">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-border/40 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
        <div className="flex flex-col items-center gap-3.5 mb-6">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
            {step === "password" ? (
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
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
              <input type="password" placeholder="Developer Key" value={password}
                onChange={(e) => setPassword(e.target.value)} disabled={loading} className={cls} />
              {error && errorMsg && <p className="text-xs text-red-400 mt-1.5 text-center font-medium">{errorMsg}</p>}
            </div>
            <button type="submit" disabled={loading}
              className="w-full h-12 bg-primary text-primary-foreground font-semibold text-sm rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] mt-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? "Decrypting…" : "Initialize Terminal"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div>
              <input type="text" inputMode="numeric" placeholder="000000" maxLength={6} value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={loading}
                className={`${cls} text-2xl font-bold tracking-[0.4em] font-mono`} />
              {error && errorMsg && <p className="text-xs text-red-400 mt-1.5 text-center font-medium">{errorMsg}</p>}
              {resent && !error && <p className="text-xs text-green-600 mt-1.5 text-center font-medium">OTP resent successfully</p>}
            </div>
            <button type="submit" disabled={loading || otp.length !== 6}
              className="w-full h-12 bg-primary text-primary-foreground font-semibold text-sm rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] mt-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? "Verifying OTP…" : "Confirm OTP"}
            </button>
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={() => { setStep("password"); setError(false); setErrorMsg(""); setOtp(""); }}
                className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors">Back</button>
              <button type="button" onClick={resendOtp} disabled={loading}
                className="text-xs text-primary hover:text-primary/70 transition-colors disabled:opacity-40">Resend OTP</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function PageTracker() {
  const [loc] = useLocation();
  useEffect(() => {
    trackPageView(loc);
  }, [loc]);
  return null;
}

// ── App ───────────────────────────────────────────────────────────────────────
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CartProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <PageTracker />
            <ScrollToTop />
            <Suspense fallback={<PageLoader />}>
              <Switch>
                {/* Public routes */}
                <Route path="/" component={Home} />
                <Route path="/recipes" component={Recipes} />
                <Route path="/contact" component={Contact} />
                <Route path="/health-benefits" component={HealthBenefits} />
                <Route path="/gallery" component={Gallery} />
                <Route path="/our-product" component={Products} />
                <Route path="/cart" component={Cart} />
                <Route path="/checkout" component={Checkout} />
                <Route path="/auth" component={Auth} />

                {/* Admin routes */}
                <Route path="/admin-earthora"><Redirect to="/admin-earthora/dashboard" /></Route>
                <Route path="/admin-earthora/:rest*">
                  <AdminGate>
                    <AdminLayout>
                      <Switch>
                        <Route path="/admin-earthora/dashboard"><AdminDashboard /></Route>
                        <Route path="/admin-earthora/products"><AdminProducts /></Route>
                        <Route path="/admin-earthora/orders"><AdminOrders /></Route>
                        <Route path="/admin-earthora/coupons"><AdminCoupons /></Route>
                        <Route path="/admin-earthora/festive"><AdminFestive /></Route>
                        <Route path="/admin-earthora/analytics"><AdminAnalytics /></Route>
                        <Route path="/admin-earthora/settings"><AdminSettings /></Route>
                        <Route><Redirect to="/admin-earthora/dashboard" /></Route>
                      </Switch>
                    </AdminLayout>
                  </AdminGate>
                </Route>

                {/* Codex routes */}
                <Route path="/codex"><Redirect to="/codex/dashboard" /></Route>
                <Route path="/codex/:rest*">
                  <CodexGate>
                    <CodexLayout>
                      <Switch>
                        <Route path="/codex/dashboard"><CodexDashboard /></Route>
                        <Route path="/codex/analytics"><CodexAnalytics /></Route>
                        <Route path="/codex/reports"><CodexReports /></Route>
                        <Route path="/codex/settings"><CodexSettings /></Route>
                        <Route><Redirect to="/codex/dashboard" /></Route>
                      </Switch>
                    </CodexLayout>
                  </CodexGate>
                </Route>

                {/* 404 */}
                <Route>
                  <div className="flex h-screen items-center justify-center bg-background">
                    <h1 className="text-2xl text-primary font-serif">Page not found</h1>
                  </div>
                </Route>
              </Switch>
            </Suspense>
          </WouterRouter>
          <ChatWidget />
        </CartProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
