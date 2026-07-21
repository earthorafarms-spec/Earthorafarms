import { lazy, Suspense, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { CartProvider } from '@/contexts/cart-context';
import { AuthProvider } from '@/contexts/auth-context';
import { trackPageView } from '@/lib/analytics';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Gate } from '@/components/Gate';
import ScrollToTop from '@/components/ScrollToTop';
import { ChatWidget } from '@/components/chat/ChatWidget';

const PageLoader = () => (
  <div className="flex min-h-[100dvh] items-center justify-center bg-background">
    <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
  </div>
);

const Home = lazy(() => import('./pages/home'));
const Recipes = lazy(() => import('./pages/recipes'));
const Contact = lazy(() => import('./pages/contact'));
const HealthBenefits = lazy(() => import('./pages/health-benefits'));
const Gallery = lazy(() => import('./pages/gallery'));
const Auth = lazy(() => import('./pages/auth'));
const Products = lazy(() => import('./pages/products'));
const Cart = lazy(() => import('./pages/cart'));
const Favorites = lazy(() => import('./pages/favorites'));
const Checkout = lazy(() => import('./pages/checkout'));

const AdminLayout = lazy(() => import('./pages/admin-earthora/layout'));
const AdminDashboard = lazy(() => import('./pages/admin-earthora/dashboard'));
const AdminProducts = lazy(() => import('./pages/admin-earthora/products'));
const AdminOrders = lazy(() => import('./pages/admin-earthora/orders'));
const AdminAnalytics = lazy(() => import('./pages/admin-earthora/analytics'));
const AdminCoupons = lazy(() => import('./pages/admin-earthora/coupons'));
const AdminFestive = lazy(() => import('./pages/admin-earthora/festive'));
const AdminSettings = lazy(() => import('./pages/admin-earthora/settings'));

const CodexLayout = lazy(() => import('./pages/codex/layout'));
const CodexDashboard = lazy(() => import('./pages/codex/dashboard'));
const CodexAnalytics = lazy(() => import('./pages/codex/analytics'));
const CodexReports = lazy(() => import('./pages/codex/reports'));
const CodexSettings = lazy(() => import('./pages/codex/settings'));

function Fallback() {
  return <Redirect to="/" />;
}

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

function PageTracker() {
  const [loc] = useLocation();
  useEffect(() => { trackPageView(loc); }, [loc]);
  return null;
}

function ConditionalChatWidget() {
  const [location] = useLocation();
  if (location.startsWith('/auth') || location.startsWith('/admin-earthora') || location.startsWith('/codex')) return null;
  return <ChatWidget />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CartProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <PageTracker />
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
                  <Route path="/favorites" component={Favorites} />
                  <Route path="/checkout" component={Checkout} />
                  <Route path="/auth" component={Auth} />

                  <Route path="/admin-earthora">
                    <Redirect to="/admin-earthora/dashboard" />
                  </Route>
                  <Route path="/admin-earthora/:rest*">
                    <Gate
                      storageKey="admin_authenticated"
                      passwordKey="admin_password"
                      title="Admin Portal"
                      subtitle="Enter your security password"
                      passwordPlaceholder="Security Password"
                      submitLabel="Authenticate"
                      loadingLabel={'Verifying\u2026'}
                      mode="admin"
                    >
                      <AdminLayout>
                        <Switch>
                          <Route path="/admin-earthora/dashboard" component={AdminDashboard} />
                          <Route path="/admin-earthora/products" component={AdminProducts} />
                          <Route path="/admin-earthora/orders" component={AdminOrders} />
                          <Route path="/admin-earthora/coupons" component={AdminCoupons} />
                          <Route path="/admin-earthora/festive" component={AdminFestive} />
                          <Route path="/admin-earthora/analytics" component={AdminAnalytics} />
                          <Route path="/admin-earthora/settings" component={AdminSettings} />
                          <Route>
                            <Redirect to="/admin-earthora/dashboard" />
                          </Route>
                        </Switch>
                      </AdminLayout>
                    </Gate>
                  </Route>

                  <Route path="/codex">
                    <Redirect to="/codex/dashboard" />
                  </Route>
                  <Route path="/codex/:rest*">
                    <Gate
                      storageKey="codex_authenticated"
                      passwordKey="codex_password"
                      title="Codex Console"
                      subtitle="Enter your developer key"
                      passwordPlaceholder="Developer Key"
                      submitLabel="Initialize Terminal"
                      loadingLabel={'Decrypting\u2026'}
                      mode="codex"
                    >
                      <CodexLayout>
                        <Switch>
                          <Route path="/codex/dashboard" component={CodexDashboard} />
                          <Route path="/codex/analytics" component={CodexAnalytics} />
                          <Route path="/codex/reports" component={CodexReports} />
                          <Route path="/codex/settings" component={CodexSettings} />
                          <Route>
                            <Redirect to="/codex/dashboard" />
                          </Route>
                        </Switch>
                      </CodexLayout>
                    </Gate>
                  </Route>

                  <Route component={Fallback} />
                </Switch>
              </Suspense>
              <ConditionalChatWidget />
            </WouterRouter>
          </CartProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
