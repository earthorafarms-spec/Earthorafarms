import { useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

interface GateProps {
  children: ReactNode;
  storageKey: string;
  passwordKey: string;
  title: string;
  subtitle: string;
  passwordPlaceholder: string;
  submitLabel: string;
  loadingLabel: string;
}

export function Gate({
  children,
  storageKey,
  passwordKey,
  title,
  subtitle,
  passwordPlaceholder,
  submitLabel,
  loadingLabel,
}: GateProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    sessionStorage.getItem(storageKey) === 'true'
  );
  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resent, setResent] = useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    setErrorMsg('');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-otp', {
        body: { password, domain: 'admin' },
      });
      if (fnError) throw fnError;
      if (data?.ok) {
        sessionStorage.setItem(passwordKey, password);
        setStep('otp');
        setResent(false);
      } else {
        setError(true);
        setErrorMsg(data?.error || 'Incorrect password');
        setPassword('');
      }
    } catch {
      setError(true);
      setErrorMsg('Connection error. Please try again.');
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
        body: { otp, domain: 'admin' },
      });
      if (fnError) throw fnError;
      if (data?.ok) {
        sessionStorage.setItem(storageKey, 'true');
        setIsAuthenticated(true);
      } else {
        setError(true);
        setErrorMsg(data?.error || 'Invalid OTP');
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
      const pwd = sessionStorage.getItem(passwordKey) || password;
      await supabase.functions.invoke('send-otp', { body: { password: pwd, domain: 'admin' } });
    } catch {
      setErrorMsg('Failed to resend OTP');
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated) return <>{children}</>;

  const inputClass = `w-full h-12 px-4 text-sm bg-[#fafaf8] border border-border/40 rounded-xl outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/5 transition-all text-center placeholder:text-foreground/30 font-medium tracking-wider`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf8] p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-border/40 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
        <div className="flex flex-col items-center gap-3.5 mb-6">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
            {step === 'password' ? (
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )}
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold text-foreground font-serif">{title}</h2>
            <p className="text-xs text-foreground/45 mt-0.5">
              {step === 'password' ? subtitle : 'Enter the OTP sent to your email'}
            </p>
          </div>
        </div>

        {step === 'password' ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                placeholder={passwordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className={inputClass}
              />
              {error && errorMsg && <p className="text-xs text-red-400 mt-1.5 text-center font-medium">{errorMsg}</p>}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-primary text-primary-foreground font-semibold text-sm rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? loadingLabel : submitLabel}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                inputMode="numeric"
                placeholder="000000"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={loading}
                className={`${inputClass} text-2xl font-bold tracking-[0.4em]`}
              />
              {error && errorMsg && <p className="text-xs text-red-400 mt-1.5 text-center font-medium">{errorMsg}</p>}
              {resent && !error && <p className="text-xs text-green-600 mt-1.5 text-center font-medium">OTP resent successfully</p>}
            </div>
            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full h-12 bg-primary text-primary-foreground font-semibold text-sm rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Verifying OTP\u2026' : 'Confirm OTP'}
            </button>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => { setStep('password'); setError(false); setErrorMsg(''); setOtp(''); }}
                className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={resendOtp}
                disabled={loading}
                className="text-xs text-primary hover:text-primary/70 transition-colors disabled:opacity-40"
              >
                Resend OTP
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
