import { useState, useEffect, useCallback } from 'react';
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, Trash2, ArrowRight, Leaf } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import {
  fetchVoiceCheckoutSession, patchVoiceCheckoutSession, verifyAndPriceVoiceCheckout,
  createVoiceCheckoutPaymentLink, fetchVoiceCheckoutStatus,
  type VoiceCheckoutSession, type VoiceCheckoutItem,
} from '@/lib/voiceCheckoutApi';

type ViewState = 'loading' | 'not_found' | 'expired' | 'unavailable' | 'edit' | 'reviewing' | 'redirecting' | 'polling' | 'success' | 'failed';

interface VoiceCheckoutProps {
  params: { token: string };
}

type CheckoutLanguage = 'en' | 'hi' | 'gu';

const CHECKOUT_COPY: Record<CheckoutLanguage, Record<string, string>> = {
  en: {
    unavailableTitle: 'Unable to load your order', linkExpired: 'This link has expired', linkNotFound: 'Link not found',
    expiredHelp: 'Please call back and ask the assistant to send you a new secure link.',
    unavailableHelp: 'The order service is temporarily unavailable. Please refresh this page in a moment.',
    invalidHelp: "This order-review link isn't valid. Please check the link or call back to start again.",
    redirecting: 'Taking you to secure payment…', confirming: 'Confirming your payment…',
    successTitle: 'Your order has been placed', successMessage: 'Thank you for your order. Your PDF invoice will be sent to your WhatsApp number shortly, and tracking details will be shared as soon as your order is dispatched.',
    backHome: 'Back to Earthora Farms', failedTitle: 'Payment not confirmed', failedMessage: "We couldn't confirm your payment. If money was deducted, please contact support — otherwise no order was placed.",
    badge: 'Secure Voice Order Review', reviewTitle: 'Review your order', reviewHelp: 'Edit anything below, then continue to secure payment. Nothing is charged until payment is completed.',
    changed: 'Prices or availability changed since we last checked — please review the updated total below.',
    items: 'Items', each: 'each', noItems: 'No items in this order.', delivery: 'Delivery details',
    fullName: 'Full Name', email: 'Email', phone: 'Phone', country: 'Country', address: 'Address', city: 'City', state: 'State', postalCode: 'Postal Code', gst: 'GST Number (optional)',
    total: 'Total', subtotal: 'Subtotal', discount: 'Discount', provisional: 'Provisional subtotal:', finalTotal: 'Press Next to get your final priced total.', next: 'Next', edit: 'Back to Edit', payNow: 'Pay now',
  },
  hi: {
    unavailableTitle: 'आपका ऑर्डर लोड नहीं हो सका', linkExpired: 'यह लिंक समाप्त हो गया है', linkNotFound: 'लिंक नहीं मिला',
    expiredHelp: 'कृपया दोबारा कॉल करके असिस्टेंट से नया सुरक्षित लिंक भेजने के लिए कहें।',
    unavailableHelp: 'ऑर्डर सेवा अभी उपलब्ध नहीं है। कृपया थोड़ी देर में पेज रीफ्रेश करें।', invalidHelp: 'यह ऑर्डर रिव्यू लिंक सही नहीं है। लिंक जाँचें या दोबारा कॉल करें।',
    redirecting: 'सुरक्षित पेमेंट पेज खोला जा रहा है…', confirming: 'पेमेंट कन्फर्म किया जा रहा है…',
    successTitle: 'आपका ऑर्डर हो गया है', successMessage: 'आपके ऑर्डर के लिए धन्यवाद। आपका PDF इनवॉइस जल्द ही आपके WhatsApp नंबर पर भेजा जाएगा और डिस्पैच होने पर ट्रैकिंग जानकारी भेजी जाएगी।',
    backHome: 'Earthora Farms पर वापस जाएँ', failedTitle: 'पेमेंट कन्फर्म नहीं हुआ', failedMessage: 'हम आपका पेमेंट कन्फर्म नहीं कर सके। अगर पैसे कट गए हैं तो सपोर्ट से संपर्क करें, वरना कोई ऑर्डर नहीं हुआ है।',
    badge: 'सुरक्षित वॉइस ऑर्डर रिव्यू', reviewTitle: 'अपना ऑर्डर जाँचें', reviewHelp: 'नीचे दी गई जानकारी बदल सकते हैं, फिर सुरक्षित पेमेंट के लिए आगे बढ़ें। पेमेंट पूरा होने तक कोई राशि नहीं ली जाएगी।',
    changed: 'पिछली जाँच के बाद कीमत या उपलब्धता बदली है। कृपया नीचे दिया गया नया टोटल जाँचें।',
    items: 'सामान', each: 'प्रति यूनिट', noItems: 'इस ऑर्डर में कोई सामान नहीं है।', delivery: 'डिलीवरी की जानकारी',
    fullName: 'पूरा नाम', email: 'ईमेल', phone: 'फोन', country: 'देश', address: 'पता', city: 'शहर', state: 'राज्य', postalCode: 'पिन कोड', gst: 'GST नंबर (वैकल्पिक)',
    total: 'कुल', subtotal: 'सबटोटल', discount: 'छूट', provisional: 'अस्थायी सबटोटल:', finalTotal: 'अंतिम टोटल पाने के लिए आगे बढ़ें दबाएँ।', next: 'आगे बढ़ें', edit: 'जानकारी बदलें', payNow: 'पेमेंट करें',
  },
  gu: {
    unavailableTitle: 'તમારો ઓર્ડર લોડ થઈ શક્યો નથી', linkExpired: 'આ લિંકની મુદત પૂરી થઈ ગઈ છે', linkNotFound: 'લિંક મળી નથી',
    expiredHelp: 'કૃપા કરીને ફરી કૉલ કરીને અસિસ્ટન્ટને નવી સુરક્ષિત લિંક મોકલવા કહો.', unavailableHelp: 'ઓર્ડર સેવા અત્યારે ઉપલબ્ધ નથી. કૃપા કરીને થોડી વારમાં પેજ રિફ્રેશ કરો.', invalidHelp: 'આ ઓર્ડર રિવ્યૂ લિંક સાચી નથી. લિંક તપાસો અથવા ફરી કૉલ કરો.',
    redirecting: 'સુરક્ષિત પેમેન્ટ પેજ ખોલી રહ્યાં છીએ…', confirming: 'પેમેન્ટ કન્ફર્મ કરી રહ્યાં છીએ…',
    successTitle: 'તમારો ઓર્ડર થઈ ગયો છે', successMessage: 'તમારા ઓર્ડર માટે આભાર. તમારું PDF ઇન્વોઇસ ટૂંક સમયમાં તમારા WhatsApp નંબર પર મોકલવામાં આવશે અને ડિસ્પેચ થયા પછી ટ્રેકિંગ માહિતી મોકલવામાં આવશે.',
    backHome: 'Earthora Farms પર પાછા જાઓ', failedTitle: 'પેમેન્ટ કન્ફર્મ થયું નથી', failedMessage: 'અમે તમારું પેમેન્ટ કન્ફર્મ કરી શક્યા નથી. પૈસા કપાયા હોય તો સપોર્ટનો સંપર્ક કરો, નહિતર કોઈ ઓર્ડર થયો નથી.',
    badge: 'સુરક્ષિત વૉઇસ ઓર્ડર રિવ્યૂ', reviewTitle: 'તમારો ઓર્ડર તપાસો', reviewHelp: 'નીચેની માહિતી બદલી શકો છો, પછી સુરક્ષિત પેમેન્ટ માટે આગળ વધો. પેમેન્ટ પૂર્ણ થાય ત્યાં સુધી કોઈ રકમ લેવામાં આવશે નહીં.',
    changed: 'છેલ્લી તપાસ પછી કિંમત અથવા ઉપલબ્ધતા બદલાઈ છે. કૃપા કરીને નીચેનો નવો કુલ તપાસો.',
    items: 'વસ્તુઓ', each: 'દર યુનિટ', noItems: 'આ ઓર્ડરમાં કોઈ વસ્તુ નથી.', delivery: 'ડિલિવરીની માહિતી',
    fullName: 'પૂરું નામ', email: 'ઈમેલ', phone: 'ફોન', country: 'દેશ', address: 'સરનામું', city: 'શહેર', state: 'રાજ્ય', postalCode: 'પિન કોડ', gst: 'GST નંબર (વૈકલ્પિક)',
    total: 'કુલ', subtotal: 'સબટોટલ', discount: 'ડિસ્કાઉન્ટ', provisional: 'અસ્થાયી સબટોટલ:', finalTotal: 'અંતિમ કુલ માટે આગળ વધો દબાવો.', next: 'આગળ વધો', edit: 'માહિતી બદલો', payNow: 'પેમેન્ટ કરો',
  },
};

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
  const language: CheckoutLanguage = session?.language ?? 'en';
  const copy = CHECKOUT_COPY[language];

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has('razorpay_payment_link_id') || query.has('razorpay_payment_id')) {
      // The payment-return effect below owns this state. Avoid racing it with
      // the normal review-form loader, which may see an expired edit window.
      setView('polling');
      return;
    }
    fetchVoiceCheckoutSession(token)
      .then((s) => {
        if (s.status === 'order_created') {
          setOrderNumber(s.orderNumber ?? null);
          setView('success');
          return;
        }
        setSession(s);
        setItems(s.items);
        setView('edit');
      })
      .catch((e: Error) => {
        if (e.message === 'expired') setView('expired');
        else if (e.message === 'not_found') setView('not_found');
        else setView('unavailable');
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

  if (view === 'not_found' || view === 'expired' || view === 'unavailable') {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#FAF9F5] text-black">
        <Navbar />
        <section className="flex-1 flex items-center justify-center px-6 py-32">
          <div className="max-w-md w-full text-center bg-[#FEFDF9] rounded-3xl border border-black/5 p-10 shadow-xl">
            <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-5">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h1 className="font-dm text-2xl text-black mb-2">
              {view === 'expired'
                ? copy.linkExpired
                : view === 'unavailable'
                  ? copy.unavailableTitle
                  : copy.linkNotFound}
            </h1>
            <p className="text-sm text-black/60">
              {view === 'expired'
                ? copy.expiredHelp
                : view === 'unavailable'
                  ? copy.unavailableHelp
                  : copy.invalidHelp}
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
          {view === 'redirecting' ? copy.redirecting : copy.confirming}
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
        <h1 className="font-dm text-2xl">{copy.successTitle}</h1>
        {orderNumber && <p className="text-sm text-white/50">{language === 'en' ? 'Order' : language === 'hi' ? 'ऑर्डर' : 'ઓર્ડર'} #{orderNumber}</p>}
        <p className="text-sm text-white/60 max-w-sm">
          {copy.successMessage}
        </p>
        <a href="/" className="mt-4 inline-flex items-center gap-2 bg-white text-black px-6 py-3 rounded-xl text-sm font-medium">
          <Leaf className="w-4 h-4" /> {copy.backHome}
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
        <h1 className="font-dm text-2xl">{copy.failedTitle}</h1>
        <p className="text-sm text-white/60 max-w-sm">
          {copy.failedMessage}
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
            <span>{copy.badge}</span>
          </div>
          <h1 className="font-dm font-normal text-3xl sm:text-4xl tracking-[-0.03em] mb-2">{copy.reviewTitle}</h1>
          <p className="text-sm text-black/60 mb-8">
            {copy.reviewHelp}
          </p>

          {error && <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>}
          {reconfirmBanner && view === 'reviewing' && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              {copy.changed}
            </div>
          )}

          <div className="bg-[#FEFDF9] rounded-2xl border border-black/5 p-6 mb-6 shadow-sm">
            <h2 className="font-dm text-lg mb-4">{copy.items}</h2>
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.productId} className="flex items-center justify-between gap-4 py-2 border-b border-black/5 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-black/40">₹{item.unitPrice.toFixed(2)} {copy.each}</p>
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
              {items.length === 0 && <p className="text-sm text-black/40 py-4 text-center">{copy.noItems}</p>}
            </div>
          </div>

          <div className="bg-[#FEFDF9] rounded-2xl border border-black/5 p-6 mb-6 shadow-sm space-y-4">
            <h2 className="font-dm text-lg mb-2">{copy.delivery}</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div><label className={labelClass}>{copy.fullName}</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.name} onChange={(e) => updateField('name', e.target.value)} /></div>
              <div><label className={labelClass}>{copy.email}</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.email} onChange={(e) => updateField('email', e.target.value)} /></div>
              <div><label className={labelClass}>{copy.phone}</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.phone} onChange={(e) => updateField('phone', e.target.value)} /></div>
              <div><label className={labelClass}>{copy.country}</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.country} onChange={(e) => updateField('country', e.target.value)} /></div>
              <div className="sm:col-span-2"><label className={labelClass}>{copy.address}</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.address} onChange={(e) => updateField('address', e.target.value)} /></div>
              <div><label className={labelClass}>{copy.city}</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.city} onChange={(e) => updateField('city', e.target.value)} /></div>
              <div><label className={labelClass}>{copy.state}</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.state} onChange={(e) => updateField('state', e.target.value)} /></div>
              <div><label className={labelClass}>{copy.postalCode}</label><input className={inputClass} disabled={view !== 'edit'} value={session.customer.postalCode} onChange={(e) => updateField('postalCode', e.target.value)} /></div>
              <div><label className={labelClass}>{copy.gst}</label><input className={`${inputClass} uppercase`} placeholder="e.g. 24ABCDE1234F1Z5" disabled={view !== 'edit'} value={session.customer.gst ?? ''} onChange={(e) => updateField('gst', e.target.value.toUpperCase())} /></div>
            </div>
          </div>

          <div className="bg-[#FEFDF9] rounded-2xl border border-black/5 p-6 mb-8 shadow-sm">
            <h2 className="font-dm text-lg mb-4">{copy.total}</h2>
            {session.pricing ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-black/60"><span>{copy.subtotal}</span><span>₹{session.pricing.subtotal.toFixed(2)}</span></div>
                {session.pricing.discount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>{session.pricing.discountReason || copy.discount}</span><span>-₹{session.pricing.discount.toFixed(2)}</span>
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
                  <span>{copy.total}</span><span>₹{session.pricing.total.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-black/50">{copy.provisional} ₹{subtotalNow.toFixed(2)} — {copy.finalTotal}</p>
            )}
          </div>

          {view === 'edit' && (
            <button
              onClick={handleNext}
              disabled={saving || items.length === 0}
              className="w-full bg-black text-white py-4 rounded-xl font-medium text-base flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{copy.next} <ArrowRight className="w-4 h-4" /></>}
            </button>
          )}

          {view === 'reviewing' && (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setView('edit')}
                className="flex-1 border border-black/15 text-black py-4 rounded-xl font-medium text-sm"
              >
                {copy.edit}
              </button>
              <button
                onClick={handlePay}
                disabled={saving}
                className="flex-1 bg-black text-white py-4 rounded-xl font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{copy.payNow} ₹{session.pricing?.total.toFixed(2)}</>}
              </button>
            </div>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
}
