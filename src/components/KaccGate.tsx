import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import {
  ShieldCheck, Mail, Lock, KeyRound, ArrowRight, RefreshCw, Leaf, CheckCircle2, Building2, Receipt, ArrowLeft
} from 'lucide-react';
import { Link } from 'wouter';
import leavesImg from '@assets/generated_images/hero_leaves_2.jpg';

interface KaccGateProps {
  children: ReactNode;
  storageKey?: string;
  passwordKey?: string;
  emailKey?: string;
}

export function KaccGate({
  children,
  storageKey = 'kacc_authenticated',
  passwordKey = 'kacc_password',
  emailKey = 'kacc_email',
}: KaccGateProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    sessionStorage.getItem(storageKey) === 'true'
  );
  const [step, setStep] = useState<'login' | 'otp'>('login');
  const [email, setEmail] = useState(() => sessionStorage.getItem(emailKey) || '');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resent, setResent] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError(true);
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    setError(false);
    setErrorMsg('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-otp', {
        body: { email, password, domain: 'kacc' },
      });
      if (fnError) throw fnError;
      if (data?.ok) {
        sessionStorage.setItem(emailKey, email);
        sessionStorage.setItem(passwordKey, password);
        setStep('otp');
        setResent(false);
      } else {
        setError(true);
        setErrorMsg(data?.error || 'Incorrect password or unauthorized key account');
        setPassword('');
      }
    } catch {
      setError(true);
      setErrorMsg('Connection error. Please check network and try again.');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    setErrorMsg('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('verify-otp', {
        body: { otp, domain: 'kacc' },
      });
      if (fnError) throw fnError;
      if (data?.ok) {
        sessionStorage.setItem(storageKey, 'true');
        setIsAuthenticated(true);
      } else {
        setError(true);
        setErrorMsg(data?.error || 'Invalid OTP verification code');
        setOtp('');
      }
    } catch {
      setError(true);
      setErrorMsg('Verification failed. Please try again.');
      setOtp('');
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    setLoading(true);
    setError(false);
    setErrorMsg('');
    setResent(true);
    try {
      const storedEmail = sessionStorage.getItem(emailKey) || email;
      const pwd = sessionStorage.getItem(passwordKey) || password;
      await supabase.functions.invoke('send-otp', {
        body: { email: storedEmail, password: pwd, domain: 'kacc' },
      });
    } catch {
      setErrorMsg('Failed to resend OTP');
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] w-full flex bg-[#0E0E0E] text-white selection:bg-white selection:text-black relative overflow-hidden font-sans">
      {/* ── Left Editorial Panel (Desktop) ── */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12 lg:p-16 border-r border-white/10">
        <div className="absolute inset-0 z-0">
          <img
            src={leavesImg}
            alt="Earthora Botanical Farm"
            className="w-full h-full object-cover opacity-35 scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0E0E0E] via-[#0E0E0E]/60 to-transparent" />
        </div>

        {/* Brand Bar */}
        <div className="relative z-10">
          <Link href="/">
            <div className="inline-flex items-center gap-2 cursor-pointer">
              <div className="w-9 h-9 rounded-full bg-emerald-700 flex items-center justify-center shadow-lg">
                <Leaf className="w-5 h-5 text-white" />
              </div>
              <span className="font-serif font-medium text-2xl tracking-tight text-white">
                Earthora
              </span>
              <span className="ml-2 px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-[10px] uppercase font-mono font-bold">
                KACC Portal
              </span>
            </div>
          </Link>
        </div>

        {/* Hero Narrative */}
        <div className="relative z-10 max-w-lg space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="text-xs uppercase font-mono text-emerald-400 font-bold tracking-widest block mb-2">
              Key Account Selling & Compliance
            </span>
            <h1 className="font-serif text-4xl sm:text-5xl font-normal leading-tight text-white tracking-tight">
              Selling Intelligence & Tax Reports Hub.
            </h1>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            className="text-base text-white/60 leading-relaxed font-inter"
          >
            Access your dedicated Key Account dashboard to monitor B2B vs. B2C retail revenue, compute Output Tax (CGST, SGST, IGST), and download complete Excel spreadsheet data.
          </motion.p>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10 text-xs font-inter text-white/70">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Direct Email OTP Authentication</span>
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>B2B Invoices with GSTIN</span>
            </div>
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>CGST, SGST & IGST Calculation</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Instant Excel (.CSV) Exports</span>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="relative z-10 text-xs text-white/30 font-mono">
          © {new Date().getFullYear()} Earthora Farms. Key Accounts Security.
        </div>
      </div>

      {/* ── Right Login Card Form Column ── */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 relative z-10 bg-[#FAF9F5] text-black">
        <div className="w-full max-w-md space-y-8">
          {/* Header Mobile Brand */}
          <div className="lg:hidden flex items-center justify-between mb-4">
            <Link href="/">
              <div className="inline-flex items-center gap-2 cursor-pointer">
                <div className="w-8 h-8 rounded-full bg-emerald-800 flex items-center justify-center">
                  <Leaf className="w-4 h-4 text-white" />
                </div>
                <span className="font-serif font-bold text-xl text-black">Earthora</span>
              </div>
            </Link>
            <span className="px-2.5 py-0.5 rounded-full bg-black/5 text-black text-[10px] font-mono font-bold uppercase">
              KACC Portal
            </span>
          </div>

          <div>
            <span className="text-xs uppercase font-mono text-emerald-800 font-bold tracking-widest block mb-1">
              Account Security Gate
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl text-black font-normal tracking-tight">
              {step === 'login' ? 'Key Account Sign In' : 'Enter OTP Code'}
            </h2>
            <p className="text-sm text-black/60 mt-2 font-inter leading-relaxed">
              {step === 'login'
                ? 'Enter your account email address and password to receive your 6-digit OTP code directly to your email.'
                : `Enter the 6-digit single-use OTP sent to ${email}`}
            </p>
          </div>

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center gap-2.5"
              >
                <ShieldCheck className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {step === 'login' ? (
            <motion.form
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              onSubmit={handleLoginSubmit}
              className="space-y-5"
            >
              <div>
                <label className="block text-xs font-medium text-black/70 mb-1.5 uppercase tracking-wider font-mono">
                  Account Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-black/40 absolute left-4 top-4" />
                  <input
                    type="email"
                    required
                    placeholder="keyaccount@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white border border-black/15 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-black placeholder:text-black/35 focus:outline-none focus:border-black transition-all shadow-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-black/70 mb-1.5 uppercase tracking-wider font-mono">
                  Security Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-black/40 absolute left-4 top-4" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white border border-black/15 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-black placeholder:text-black/35 focus:outline-none focus:border-black transition-all shadow-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-black text-white font-medium py-4 rounded-2xl text-sm hover:bg-black/85 transition-all flex items-center justify-center gap-2 shadow-xl disabled:opacity-50 group cursor-pointer"
              >
                {loading ? (
                  <span>Sending OTP Email…</span>
                ) : (
                  <>
                    <span>Authenticate & Dispatch OTP</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>

              <div className="pt-4 border-t border-black/8 text-center">
                <Link href="/" className="text-xs text-black/50 hover:text-black transition-colors inline-flex items-center gap-1.5 font-medium">
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Return to Earthora Farms Store</span>
                </Link>
              </div>
            </motion.form>
          ) : (
            <motion.form
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              onSubmit={handleOtpSubmit}
              className="space-y-5"
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-black/70 uppercase tracking-wider font-mono">
                    6-Digit Verification OTP
                  </label>
                  <button
                    type="button"
                    onClick={() => setStep('login')}
                    className="text-xs text-emerald-800 font-semibold underline hover:text-black transition-colors"
                  >
                    Change Email
                  </button>
                </div>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-black/40 absolute left-4 top-4" />
                  <input
                    type="text"
                    maxLength={6}
                    required
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-white border border-black/15 rounded-2xl pl-11 pr-4 py-3.5 text-center text-xl tracking-[0.5em] font-mono font-bold text-black placeholder:text-black/25 focus:outline-none focus:border-black transition-all shadow-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full bg-black text-white font-medium py-4 rounded-2xl text-sm hover:bg-black/85 transition-all flex items-center justify-center gap-2 shadow-xl disabled:opacity-50 cursor-pointer"
              >
                {loading ? <span>Verifying Code…</span> : <span>Verify OTP & Enter KACC Portal</span>}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={resendOtp}
                  disabled={loading}
                  className="text-xs text-emerald-800 font-medium hover:text-emerald-950 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>{resent ? 'OTP Resent to Email' : 'Resend OTP to Email'}</span>
                </button>
              </div>
            </motion.form>
          )}
        </div>
      </div>
    </div>
  );
}
