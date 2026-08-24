import { useState, useEffect, useCallback } from 'react';
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, Trash2, ArrowRight, Leaf } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import {
  fetchVoiceCheckoutSession, patchVoiceCheckoutSession, verifyAndPriceVoiceCheckout,
  createVoiceCheckoutPaymentLink, fetchVoiceCheckoutStatus,
  type VoiceCheckoutSession, type VoiceCheckoutItem,
} from '@/lib/voiceCheckoutApi';

type ViewState = 'loading' | 'not_found' | 'expired' | 'edit' | 'reviewing' | 'redirecting' | 'polling' | 'success' | 'failed';

interface VoiceCheckoutProps {
  params: { token: string };
}

const inputClass =
  'w-full bg-[#F4F3EE] border border-black/10 rounded-xl px-4 py-3 text-sm text-black focus:outline-none focus:border-black/30 transition-colors';
const labelClass = 'text-xs uppercase tracking-wider text-black/60 font-medium block mb-1.5';

export default function VoiceCheckout({ params }: VoiceCheckoutProps) {
  const { token } = params;
  const [view, setView] = useState<ViewState>('loading');
  const [session, setSession] = useState<VoiceCheckoutSession | null>(null);
  const [items, setItems] = useState<VoiceCheckoutItem[]>([]);
  const [error, setError] = useState('');
  const [reconfirmBanner, setReconfirmBanner] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchVoiceCheckoutSession(token)
      .then((s) => {
        setSession(s);
        setItems(s.items);
        setView('edit');
      })
      .catch((e: Error) => {
        setView(e.message === 'expired' ? 'expired' : 'not_found');
      });
  }, [token]);

  // If Razorpay redirected back here (callback_url points at this same page),
  // poll status rather than trusting any query parameter as proof of payment.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('razorpay_payment_link_id') && !params.has('razorpay_payment_id')) return;

    setView('polling');
    let cancelled = false;
    const poll = async () => {
      for (let i = 0; i < 20 && !cancelled; i++) {
        const status = await fetchVoiceCheckoutStatus(token).catch(() => null);
        if (status?.status === 'order_created') {
          setOrderNumber(status.orderNumber);
          setView('success');
          return;
        }
        if (status?.status === 'payment_failed' || status?.status === 'finalization_failed') {
          setView('failed');
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!cancelled) setView('failed');
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const updateField = useCallback(<K extends keyof NonNullable<typeof session>['customer']>(
    field: K,
    value: NonNullable<typeof session>['customer'][K]
  ) => {
    setSession((prev) => (prev ? { ...prev, customer: { ...prev.customer, [field]: value } } : prev));
  }, []);

  const updateQuantity = (productId: string, quantity: number) => {
    setItems((prev) =>
      quantity <= 0
        ? prev.filter((i) => i.productId !== productId)
        : prev.map((i) => (i.productId === productId ? { ...i, quantity } : i))
    );
  };

  const handleNext = async () => {
    if (!session) return;
    setSaving(true);
    setError('');
    try {
      await patchVoiceCheckoutSession(token, {
        ...session.customer,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      });
      const { pricing, requiresReconfirmation } = await verifyAndPriceVoiceCheckout(token);
      setSession((prev) => (prev ? { ...prev, pricing } : prev));
      setReconfirmBanner(requiresReconfirmation);
      setView('reviewing');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handlePay = async () => {
    setSaving(true);
    setError('');
    try {
      const { paymentLinkUrl } = await createVoiceCheckoutPaymentLink(token);
      setView('redirecting');
      window.location.href = paymentLinkUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start payment. Please try again.');
      setSaving(false);
    }
  };

  if (view === 'loading') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#FAF9F5]">
        <Loader2 className="w-6 h-6 animate-spin text-black/40" />
      </div>
    );
  }

  if (view === 'not_found' || view === 'expired') {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black">
        <Navbar />
        <section className="flex-1 flex items-center justify-center px-6 py-32">
          <div className="max-w-md w-full text-center bg-[#FEFDF9] rounded-3xl border border-black/5 p-10 shadow-xl">
            <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-5">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h1 className="font-dm text-2xl text-black mb-2">
              {view === 'expired' ? 'This link has expired' : 'Link not found'}
            </h1>
            <p className="text-sm text-black/60">
              {view === 'expired'
                ? 'Please call back and ask the assistant to send you a new secure link.'
                : "This checkout link isn't valid. Please check the link or call back to start again."}
            </p>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  if (view === 'polling' || view === 'redirecting') {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#0E0E0E] text-white gap-4">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm text-white/60">
          {view === 'redirecting' ? 'Taking you to secure payment…' : 'Confirming your payment…'}
        </p>
      </div>
    );
  }

  if (view === 'success') {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#0E0E0E] text-white gap-4 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>
        <h1 className="font-dm text-2xl">Payment confirmed!</h1>
        {orderNumber && <p className="text-sm text-white/50">Order #{orderNumber.slice(0, 12)}</p>}
        <p className="text-sm text-white/60 max-w-sm">
          Thank you for your order — a confirmation and invoice will arrive by email shortly.
        </p>
        <a href="/" className="mt-4 inline-flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl text-sm font-medium">
          <Leaf className="w-4 h-4" /> Back to Earthora Farms
        </a>
      </div>
    );
  }

  if (view === 'failed') {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#0E0E0E] text-white gap-4 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-rose-400" />
        </div>
        <h1 className="font-dm text-2xl">Payment not confirmed</h1>
        <p className="text-sm text-white/60 max-w-sm">
          We couldn't confirm your payment. If money was deducted, please contact support — otherwise no order was placed.
        </p>
      </div>
    );
  }

  if (!session) return null;
  const subtotalNow = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black">
      <Navbar />
      <section className="flex-1 pt-32 pb-20">
        <div className="container mx-auto px-6 max-w-3xl">
          <div className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/5 border border-black/10 font-dm font-medium text-xs text-black/70 uppercase tracking-wider">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
            <span>Secure Voice Order Review</span>
          </div>
          <h1 className="font-dm font-normal text-3xl sm:text-4xl tracking-[-0.03em] mb-2">Review your order</h1>
          <p className="text-sm text-black/60 mb-8">
            Edit anything below, then continue to secure payment. Nothing is charged until you complete payment on Razorpay.
          </p>

          {error && <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>}
          {reconfirmBanner && view === 'reviewing' && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              Prices or availability changed since we last checked — please review the updated total below.
            </div>
          )}

          <div className="bg-[#FEFDF9] rounded-2xl border border-black/5 p-6 mb-6 shadow-sm">
            <h2 className="font-dm text-lg mb-4">Items</h2>
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.productId} className="flex items-center justify-between gap-4 py-2 border-b border-black/5 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-black/40">₹{item.unitPrice.toFixed(2)} each</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <input
                      type="number"
                      min={0}
                      value={item.quantity}
                      disabled={view !== 'edit'}
                      onChange={(e) => updateQuantity(item.productId, Number(e.target.value))}
                      className="w-16 text-center bg-[#F4F3EE] border border-black/10 rounded-lg px-2 py-1.5 text-sm"
                    />
                    {view === 'edit' && (
                      <button onClick={() => updateQuantity(item.productId, 0)} className="text-black/30 hover:text-rose-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {items.length === 0 && <p className="text-sm text-black/40 py-4 text-center">No items in this order.</p>}
            </div>
          </div>

          <div className="bg-[#FEFDF9] rounded-2xl border border-black/5 p-6 mb-6 shadow-sm space-y-4">
            <h2 className="font-dm text-lg mb-2">Delivery details</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div><label className={labelClass}>Full Name</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.name} onChange={(e) => updateField('name', e.target.value)} /></div>
              <div><label className={labelClass}>Email</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.email} onChange={(e) => updateField('email', e.target.value)} /></div>
              <div><label className={labelClass}>Phone</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.phone} onChange={(e) => updateField('phone', e.target.value)} /></div>
              <div><label className={labelClass}>Country</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.country} onChange={(e) => updateField('country', e.target.value)} /></div>
              <div className="sm:col-span-2"><label className={labelClass}>Address</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.address} onChange={(e) => updateField('address', e.target.value)} /></div>
              <div><label className={labelClass}>City</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.city} onChange={(e) => updateField('city', e.target.value)} /></div>
              <div><label className={labelClass}>State</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.state} onChange={(e) => updateField('state', e.target.value)} /></div>
              <div><label className={labelClass}>Postal Code</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.postalCode} onChange={(e) => updateField('postalCode', e.target.value)} /></div>
              <div><label className={labelClass}>GST Number (optional)</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.gst ?? ''} onChange={(e) => updateField('gst', e.target.value)} /></div>
            </div>
          </div>

          <div className="bg-[#FEFDF9] rounded-2xl border border-black/5 p-6 mb-8 shadow-sm">
            <h2 className="font-dm text-lg mb-4">Total</h2>
            {session.pricing ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-black/60"><span>Subtotal</span><span>₹{session.pricing.subtotal.toFixed(2)}</span></div>
                {session.pricing.discount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>{session.pricing.discountReason || 'Discount'}</span><span>-₹{session.pricing.discount.toFixed(2)}</span>
                  </div>
                )}
                {session.pricing.gst.isIndia && session.pricing.gst.isGujarat && (
                  <>
                    <div className="flex justify-between text-black/50"><span>CGST</span><span>₹{session.pricing.gst.cgstAmount.toFixed(2)}</span></div>
                    <div className="flex justify-between text-black/50"><span>SGST</span><span>₹{session.pricing.gst.sgstAmount.toFixed(2)}</span></div>
                  </>
                )}
                {session.pricing.gst.isIndia && !session.pricing.gst.isGujarat && (
                  <div className="flex justify-between text-black/50"><span>IGST</span><span>₹{session.pricing.gst.igstAmount.toFixed(2)}</span></div>
                )}
                {session.pricing.couponError && <p className="text-xs text-rose-600">{session.pricing.couponError}</p>}
                <div className="flex justify-between pt-3 border-t border-black/10 text-base font-semibold">
                  <span>Total</span><span>₹{session.pricing.total.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-black/50">Provisional subtotal: ₹{subtotalNow.toFixed(2)} — press Next to get your final priced total.</p>
            )}
          </div>

          {view === 'edit' && (
            <button
              onClick={handleNext}
              disabled={saving || items.length === 0}
              className="w-full bg-black text-white py-4 rounded-xl font-medium text-base flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Next <ArrowRight className="w-4 h-4" /></>}
            </button>
          )}

          {view === 'reviewing' && (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setView('edit')}
                className="flex-1 border border-black/15 text-black py-4 rounded-xl font-medium text-sm"
              >
                Back to Edit
              </button>
              <button
                onClick={handlePay}
                disabled={saving}
                className="flex-1 bg-black text-white py-4 rounded-xl font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Pay ₹{session.pricing?.total.toFixed(2)} Now</>}
              </button>
            </div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
}
