import { createRoot } from 'react-dom/client';

import App from './App';
import { CartProvider } from './contexts/cart-context';
import { Toaster } from './components/ui/toaster';

import './index.css';

createRoot(document.getElementById('root')!).render(
  <CartProvider>
    <App />
    <Toaster />
  </CartProvider>
);
