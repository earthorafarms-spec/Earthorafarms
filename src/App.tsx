import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { ChatWidget } from './components/chat/ChatWidget';
import Home from './pages/home';
import Recipes from './pages/recipes';
import Contact from './pages/contact';
import HealthBenefits from './pages/health-benefits';
import Gallery from './pages/gallery';
import Auth from './pages/auth';
import Products from './pages/products';
import Cart from './pages/cart';
import AdminLayout from './pages/admin/layout';
import AdminDashboard from './pages/admin/dashboard';
import AdminProducts from './pages/admin/products';
import AdminOrders from './pages/admin/orders';
import AdminAnalytics from './pages/admin/analytics';
import AdminCoupons from './pages/admin/coupons';
import AdminChat from './pages/admin/chat';
import ScrollToTop from './components/ScrollToTop';

const queryClient = new QueryClient();

function AdminGate({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem("admin_authenticated") === "true";
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === "KAI_2828") {
      sessionStorage.setItem("admin_authenticated", "true");
      setIsAuthenticated(true);
      setError(false);
    } else {
      setError(true);
      setPassword("");
    }
  };

  if (isAuthenticated) {
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
        <p className="text-sm text-white/60 mb-8 font-light">Please enter the security password to proceed</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1 text-left">
            <input
              type="password"
              placeholder="Security Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full h-13 px-4 rounded-xl bg-white/5 border text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-accent transition-all ${
                error ? "border-red-500/50 focus:ring-red-500/50" : "border-white/10"
              }`}
              autoFocus
            />
            {error && (
              <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1 font-medium px-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Incorrect security password
              </p>
            )}
          </div>

          <button
            type="submit"
            className="w-full h-13 bg-accent text-primary font-bold rounded-xl hover:bg-accent/90 transition-all shadow-md shadow-accent/10 active:scale-[0.98] mt-2 text-sm uppercase tracking-wider"
          >
            Authenticate
          </button>
        </form>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <ScrollToTop />
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
            {(params) => (
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
          <Route>
            <div className="flex h-screen items-center justify-center bg-background">
              <h1 className="text-2xl text-primary font-serif">Page not found</h1>
            </div>
          </Route>
        </Switch>
      </WouterRouter>
      <ChatWidget />
    </QueryClientProvider>
  );
}

export default App;
