import { lazy, Suspense, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { CartProvider } from '@/contexts/cart-context';
import { AuthProvider } from '@/contexts/auth-context';
import { trackPageView } from '@/lib/analytics';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Gate } from '@/components/Gate';
import ScrollToTop from '@/components/ScrollToTop';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

const PageLoader = () => <PageSkeleton />;

import Home from './pages/home';
import Recipes from './pages/recipes';
import Contact from './pages/contact';
import HealthBenefits from './pages/health-benefits';
import Gallery from './pages/gallery';
import Auth from './pages/auth';
import Products from './pages/products';
import Cart from './pages/cart';
import Favorites from './pages/favorites';
import Checkout from './pages/checkout';
import ShippingPolicy from './pages/shipping-policy';
import FAQ from './pages/faq';
import PrivacyPolicy from './pages/privacy-policy';
import TermsOfUse from './pages/terms-of-use';
import CookieSettings from './pages/cookie-settings';

const AdminLayout = lazy(() => import('./pages/admin-earthora/layout'));
const AdminDashboard = lazy(() => import('./pages/admin-earthora/dashboard'));
const AdminProducts = lazy(() => import('./pages/admin-earthora/products'));
const AdminOrders = lazy(() => import('./pages/admin-earthora/orders'));
const AdminAnalytics = lazy(() => import('./pages/admin-earthora/analytics'));
const AdminCoupons = lazy(() => import('./pages/admin-earthora/coupons'));
const AdminFestive = lazy(() => import('./pages/admin-earthora/festive'));
const AdminSettings = lazy(() => import('./pages/admin-earthora/settings'));

import NotFound from './pages/not-found';

function Fallback() {
  return <NotFound />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

function PageTracker() {
  const [loc] = useLocation();
  useEffect(() => { trackPageView(loc); }, [loc]);
  return null;
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
                  <Route path="/shipping-policy" component={ShippingPolicy} />
                  <Route path="/faq" component={FAQ} />
                  <Route path="/privacy-policy" component={PrivacyPolicy} />
                  <Route path="/terms-of-use" component={TermsOfUse} />
                  <Route path="/cookie-settings" component={CookieSettings} />
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

                  <Route component={Fallback} />
                </Switch>
              </Suspense>
            </WouterRouter>
          </CartProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
