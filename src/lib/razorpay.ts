// src/lib/razorpay.ts
// Frontend helper — opens the Razorpay Standard Checkout modal.
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
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  image?: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  theme?: {
    color?: string;
  };
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (response: RazorpayFailureResponse) => void) => void;
}

export interface RazorpaySuccessResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
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
  onSuccess: (response: RazorpaySuccessResponse) => void;
  onFailure: (reason: string) => void;
  onDismiss?: () => void;
}

/**
 * Opens the Razorpay Standard Checkout modal.
 * Must be called after window.Razorpay is available (checkout.js loaded in index.html).
 */
export function openRazorpayModal({
  orderId,
  amount,
  currency,
  keyId,
  prefill,
  onSuccess,
  onFailure,
  onDismiss,
}: OpenRazorpayModalOptions): void {
  if (!window.Razorpay) {
    onFailure('Razorpay SDK failed to load. Please refresh and try again.');
    return;
  }

  const activeKeyId = keyId || (import.meta.env.VITE_RAZORPAY_KEY_ID as string) || 'rzp_test_1DP5mmOlF5G5ag';

  const options: any = {
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

  const rzp = new window.Razorpay(options);

  rzp.on('payment.failed', (response: RazorpayFailureResponse) => {
    const msg = response?.error?.description || 'Payment failed. Please try again.';
    onFailure(msg);
  });

  rzp.open();
}
