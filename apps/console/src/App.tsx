import { useEffect, useState } from 'react';
import { LayoutDashboard, BookOpen, Workflow, Wrench, Radio, MessageSquare, FlaskConical, LogOut, Leaf } from 'lucide-react';
import { auth, type StaffUser } from './api';
import { Spinner } from './ui';
import { Dashboard } from './modules/Dashboard';
import { Knowledgebase } from './modules/Knowledgebase';
import { Workflows } from './modules/Workflows';
import { Functions } from './modules/Functions';
import { Channels } from './modules/Channels';
import { Conversations } from './modules/Conversations';
import { TestLab } from './modules/TestLab';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'knowledgebase', label: 'Knowledgebase', icon: BookOpen },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'functions', label: 'Functions', icon: Wrench },
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'conversations', label: 'Conversations', icon: MessageSquare },
  { id: 'testlab', label: 'Test Lab', icon: FlaskConical },
] as const;

export function App() {
  const [user, setUser] = useState<StaffUser | null | undefined>(undefined);
  const [tab, setTab] = useState<string>(() => location.hash.slice(1) || 'dashboard');
  useEffect(() => { auth.me().then((r) => setUser(r.user)).catch(() => setUser(null)); }, []);
  useEffect(() => { location.hash = tab; }, [tab]);

  if (user === undefined) return <div className="h-screen flex items-center justify-center text-[#7d8f83]"><Spinner /></div>;
  if (!user) return <Login onDone={setUser} />;

  return (
    <div className="flex h-screen">
      <aside className="w-60 shrink-0 flex flex-col border-r border-[#1c2822] bg-[#101815]">
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-[#1c2822]">
          <div className="w-9 h-9 rounded-xl bg-[#2f6d48] flex items-center justify-center"><Leaf className="w-5 h-5 text-white" /></div>
          <div><div className="font-serif text-[15px] leading-tight">Earthora</div><div className="text-[10px] text-[#7d8f83] uppercase tracking-widest">AI Console</div></div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setTab(n.id)} className={`w-full flex items-center gap-3 px-3 h-10 rounded-lg text-sm transition ${tab === n.id ? 'bg-[#1c2b23] text-white' : 'text-[#93a49a] hover:text-white hover:bg-[#161f1a]'}`}>
              <n.icon className="w-[18px] h-[18px]" /> {n.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-[#1c2822]">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-[#DC9950] flex items-center justify-center text-[#15271d] text-xs font-bold">{user.email[0].toUpperCase()}</div>
            <div className="flex-1 min-w-0"><div className="text-xs truncate">{user.email}</div><div className="text-[10px] text-[#7d8f83]">{user.roles.join(', ')}</div></div>
            <button onClick={() => auth.logout().then(() => setUser(null))} className="text-[#7d8f83] hover:text-white"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {tab === 'dashboard' && <Dashboard onOpen={setTab} />}
          {tab === 'knowledgebase' && <Knowledgebase />}
          {tab === 'workflows' && <Workflows />}
          {tab === 'functions' && <Functions />}
          {tab === 'channels' && <Channels />}
          {tab === 'conversations' && <Conversations />}
          {tab === 'testlab' && <TestLab />}
        </div>
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: (u: StaffUser) => void }) {
  const [step, setStep] = useState<'cred' | 'otp'>('cred');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState(''); const [hint, setHint] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submitCred = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await auth.login(email.trim(), password); setChallengeId(r.challengeId); setHint(r.otpEmailHint); if (r.devOtp) setOtp(r.devOtp); setStep('otp'); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const submitOtp = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setErr(''); try { const r = await auth.verify(challengeId, otp); onDone(r.user); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div className="h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-sm p-8">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-[#2f6d48] flex items-center justify-center"><Leaf className="w-6 h-6 text-white" /></div>
          <div className="text-center"><div className="font-serif text-lg">Earthora AI Console</div><div className="text-xs text-[#7d8f83] mt-0.5">{step === 'cred' ? 'Sign in to continue' : `Enter the code sent to ${hint}`}</div></div>
        </div>
        {step === 'cred' ? (
          <form onSubmit={submitCred} className="space-y-3">
            <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            {err && <p className="text-xs text-red-400 text-center">{err}</p>}
            <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? <Spinner /> : 'Continue'}</button>
          </form>
        ) : (
          <form onSubmit={submitOtp} className="space-y-3">
            <input className="input text-center text-xl tracking-[0.4em]" inputMode="numeric" maxLength={6} placeholder="000000" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            {err && <p className="text-xs text-red-400 text-center">{err}</p>}
            <button className="btn btn-primary w-full justify-center" disabled={busy || otp.length !== 6}>{busy ? <Spinner /> : 'Verify'}</button>
            <button type="button" className="text-xs text-[#7d8f83] w-full" onClick={() => setStep('cred')}>Back</button>
          </form>
        )}
      </div>
    </div>
  );
}
