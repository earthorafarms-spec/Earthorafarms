import { useEffect, useState, type ReactNode } from 'react';
import { authApi, hasRole, type StaffUser } from '@/lib/apiClient';

interface GateProps {
  children: ReactNode;
  /** Legacy sessionStorage flag kept so existing layout code that reads it still works. */
  storageKey: string;
  passwordKey?: string;
  title: string;
  subtitle: string;
  passwordPlaceholder?: string;
  submitLabel: string;
  loadingLabel: string;
  /** Portal domain → required role. */
  domain?: 'admin' | 'developer' | 'kacc';
}

const ROLE_FOR_DOMAIN: Record<string, string[]> = { admin: ['admin'], developer: ['developer'], kacc: ['kacc', 'admin'] };

/**
 * Staff sign-in: email + password → 6-digit email OTP → server session cookie.
 * Replaces the password-only Supabase Edge Function gates; authorization is enforced by the API on every call.
 */
export function Gate({ children, storageKey, title, subtitle, submitLabel, loadingLabel, domain = 'admin' }: GateProps) {
  const [user, setUser] = useState<StaffUser | null | undefined>(undefined);
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [email, setEmail] = useState(() => localStorage.getItem('earthora_staff_email') || '');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [resent, setResent] = useState(false);

  useEffect(() => {
    authApi.me().then((r) => setUser(r.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user && hasRole(user, ...ROLE_FOR_DOMAIN[domain])) sessionStorage.setItem(storageKey, 'true');
  }, [user, domain, storageKey]);

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErrorMsg(''); setResent(false);
    try {
      const r = await authApi.login(email.trim(), password);
      localStorage.setItem('earthora_staff_email', email.trim());
      setChallengeId(r.challengeId); setHint(r.otpEmailHint); setStep('otp');
      if (r.devOtp) setOtp(r.devOtp);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      setPassword('');
    } finally { setLoading(false); }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErrorMsg('');
    try {
      const r = await authApi.verify(challengeId, otp);
      setUser(r.user);
      if (!hasRole(r.user, ...ROLE_FOR_DOMAIN[domain])) setErrorMsg('Your account does not have access to this portal.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed. Please try again.');
      setOtp('');
    } finally { setLoading(false); }
  };

  const resend = async () => {
    setLoading(true); setErrorMsg(''); setResent(false);
    try {
      const r = await authApi.login(email.trim(), password);
      setChallengeId(r.challengeId); setResent(true); if (r.devOtp) setOtp(r.devOtp);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not resend the code.');
      setStep('credentials');
    } finally { setLoading(false); }
  };

  if (user === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-[#fafaf8] text-sm text-foreground/50">Checking your session…</div>;
  }
  if (user && hasRole(user, ...ROLE_FOR_DOMAIN[domain])) return <>{children}</>;

  const inputClass = 'w-full h-12 px-4 text-sm bg-[#fafaf8] border border-border/40 rounded-xl outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/5 transition-all placeholder:text-foreground/30 font-medium';

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf8] p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-border/40 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
        <div className="flex flex-col items-center gap-3.5 mb-6">
          <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {step === 'credentials'
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />}
            </svg>
          </div>
          <div className="text-center">
            <h2 className="text-lg font-bold text-foreground font-serif">{title}</h2>
            <p className="text-xs text-foreground/45 mt-0.5">{step === 'credentials' ? subtitle : `Enter the 6-digit code sent to ${hint}`}</p>
          </div>
        </div>

        {user && <p className="text-xs text-red-400 mb-3 text-center font-medium">Signed in as {user.email}, but this account cannot open this portal.</p>}

        {step === 'credentials' ? (
          <form onSubmit={submitCredentials} className="space-y-3">
            <input type="email" autoComplete="username" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} className={inputClass} required />
            <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} className={inputClass} required />
            {errorMsg && <p className="text-xs text-red-400 text-center font-medium">{errorMsg}</p>}
            <button type="submit" disabled={loading} className="w-full h-12 bg-primary text-primary-foreground font-semibold text-sm rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] mt-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? loadingLabel : submitLabel}
            </button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="space-y-4">
            <div>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={loading} className={`${inputClass} text-center text-2xl font-bold tracking-[0.4em]`} />
              {errorMsg && <p className="text-xs text-red-400 mt-1.5 text-center font-medium">{errorMsg}</p>}
              {resent && !errorMsg && <p className="text-xs text-green-600 mt-1.5 text-center font-medium">A new code was sent</p>}
            </div>
            <button type="submit" disabled={loading || otp.length !== 6} className="w-full h-12 bg-primary text-primary-foreground font-semibold text-sm rounded-xl hover:bg-primary/90 transition-all active:scale-[0.98] mt-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? 'Verifying…' : 'Confirm code'}
            </button>
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={() => { setStep('credentials'); setErrorMsg(''); setOtp(''); }} className="text-xs text-foreground/40 hover:text-foreground/70 transition-colors">Back</button>
              <button type="button" onClick={resend} disabled={loading} className="text-xs text-primary hover:text-primary/70 transition-colors disabled:opacity-40">Resend code</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
