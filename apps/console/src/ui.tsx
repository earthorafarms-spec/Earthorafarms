import { useEffect, useState, type ReactNode } from 'react';

export function Spinner() { return <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />; }

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="card p-5">
      <div className="text-[11px] uppercase tracking-wider text-[#7d8f83] font-semibold">{label}</div>
      <div className="text-3xl font-serif mt-2" style={{ color: accent || '#e8eee9' }}>{value}</div>
      {sub && <div className="text-xs text-[#7d8f83] mt-1">{sub}</div>}
    </div>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#cdd8d0]">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="w-11 h-6 rounded-full relative transition" style={{ background: on ? '#2f6d48' : '#2a3830' }}>
      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} />
    </button>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[88vh] overflow-auto p-6`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="font-serif text-lg">{title}</h3><button onClick={onClose} className="text-[#7d8f83] hover:text-white text-xl leading-none">×</button></div>
        {children}
      </div>
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [n, setN] = useState(0);
  useEffect(() => { let alive = true; setLoading(true); fn().then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false)); return () => { alive = false; }; /* eslint-disable-next-line */ }, [...deps, n]);
  return { data, loading, error, reload: () => setN((x) => x + 1) };
}

export function Empty({ children }: { children: ReactNode }) { return <div className="text-center text-[#7d8f83] text-sm py-10">{children}</div>; }
