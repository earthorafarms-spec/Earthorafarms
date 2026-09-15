// src/lib/razorpay.ts
// Frontend helper — opens the Razorpay Magic Checkout (1-click) modal.
// KEY_SECRET is NEVER used here. Only the public KEY_ID is referenced.

let _rzpScriptPromise: Promise<void> | null = null;

/** Dynamically injects the Razorpay checkout.js once, returning a promise that resolves when ready. */
export function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (_rzpScriptPromise) return _rzpScriptPromise;
  _rzpScriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Razorpay SDK failed to load.'));
    document.head.appendChild(s);
  });
  return _rzpScriptPromise;
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (response: RazorpayFailureResponse) => void) => void;
}

export interface RazorpayShippingAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country?: string;
  zipcode?: string;
  type?: string;
}

export interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
  // Magic Checkout may echo these fields directly in the handler payload
  contact?: string;
  email?: string;
  shipping_address?: RazorpayShippingAddress;
  billing_address?: RazorpayShippingAddress;
}

export interface RazorpayFailureResponse {
  error: {
    code: string;
    description: string;
    source: string;
    step: string;
    reason: string;
    metadata: { payment_id?: string; order_id?: string };
  };
}

export interface OpenRazorpayModalOptions {
  orderId: string;
  amount: number; // in paise
  currency: string;
  keyId: string;
  prefill?: { name?: string; email?: string; contact?: string };
  /** Enable Razorpay Magic Checkout (1-click) — address is collected in the modal. */
  oneClickCheckout?: boolean;
  onSuccess: (response: RazorpaySuccessResponse) => void;
  onFailure: (reason: string) => void;
  onDismiss?: () => void;
}

/**
 * Opens the Razorpay checkout modal. When `oneClickCheckout` is true, the modal
 * runs in Magic Checkout mode and collects the shipping address itself.
 */
export function openRazorpayModal({
  orderId,
  amount,
  currency,
  keyId,
  prefill,
  oneClickCheckout,
  onSuccess,
  onFailure,
  onDismiss,
}: OpenRazorpayModalOptions): void {
  if (!window.Razorpay) {
    onFailure('Razorpay SDK failed to load. Please refresh and try again.');
    return;
  }

  const activeKeyId = keyId || (import.meta.env.VITE_RAZORPAY_KEY_ID as string) || 'rzp_test_1DP5mmOlF5G5ag';

  const options: Record<string, unknown> = {
    key: activeKeyId,
    amount,
    currency: currency || 'INR',
    name: 'Earthora Farms',
    description: 'Organic Moringa Products',
    image: '/favicon.svg',
    prefill,
    theme: {
      color: '#3d6b3f',
    },
    handler: (response: RazorpaySuccessResponse) => {
      onSuccess(response);
    },
    modal: {
      ondismiss: () => {
        if (onDismiss) onDismiss();
        else onFailure('Payment cancelled by user.');
      },
    },
  };

  if (orderId && !orderId.startsWith('order_demo_')) {
    options.order_id = orderId;
  }

  if (oneClickCheckout) {
    options.one_click_checkout = true;
    options.show_coupons = false;
  }

  const rzp = new window.Razorpay(options);

  rzp.on('payment.failed', (response: RazorpayFailureResponse) => {
    const msg = response?.error?.description || 'Payment failed. Please try again.';
    onFailure(msg);
  });

  rzp.open();
}
