import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
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
import AdminReviews from './pages/admin/reviews';
import ScrollToTop from './components/ScrollToTop';

const queryClient = new QueryClient();

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
          <Route path="/admin/:rest*">
            {(params) => (
              <AdminLayout>
                <Switch>
                  <Route path="/admin/dashboard"><AdminDashboard /></Route>
                  <Route path="/admin/products"><AdminProducts /></Route>
                  <Route path="/admin/orders"><AdminOrders /></Route>
                  <Route path="/admin/reviews"><AdminReviews /></Route>
                  <Route><Redirect to="/admin/dashboard" /></Route>
                </Switch>
              </AdminLayout>
            )}
          </Route>
          <Route>
            <div className="flex h-screen items-center justify-center bg-background">
              <h1 className="text-2xl text-primary font-serif">Page not found</h1>
            </div>
          </Route>
        </Switch>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
