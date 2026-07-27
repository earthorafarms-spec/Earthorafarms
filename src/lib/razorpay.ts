// src/lib/razorpay.ts
// Frontend helper — opens the Razorpay Standard Checkout modal.
// KEY_SECRET is NEVER used here. Only the public KEY_ID is referenced.

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

  const rzp = new window.Razorpay({
    key:         keyId,
    amount,
    currency,
    order_id:    orderId,
    name:        'Earthora Farms',
    description: 'Organic Moringa Products',
    image:       '/favicon.svg',
    prefill,
    theme: {
      color: '#3d6b3f', // matches primary green brand color
    },
    handler: (response) => {
      onSuccess(response);
    },
    modal: {
      ondismiss: () => {
        if (onDismiss) onDismiss();
        else onFailure('Payment cancelled by user.');
      },
    },
  });

  rzp.on('payment.failed', (response: RazorpayFailureResponse) => {
    const msg = response?.error?.description || 'Payment failed. Please try again.';
    onFailure(msg);
  });

  rzp.open();
}
