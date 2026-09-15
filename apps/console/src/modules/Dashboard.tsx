import { api } from '../api';
import { Stat, Section, useAsync, Spinner, Empty } from '../ui';

export function Dashboard({ onOpen }: { onOpen: (t: string) => void }) {
  const { data, loading } = useAsync(() => Promise.all([api('/platform/dashboard'), api('/platform/status')]).then(([d, s]) => ({ d, s })), []);
  if (loading || !data) return <div className="text-[#7d8f83]"><Spinner /> Loading…</div>;
  const { d, s } = data as any;
  return (
    <div className="space-y-6">
      <div><h1 className="font-serif text-2xl">Dashboard</h1><p className="text-sm text-[#7d8f83] mt-1">Your AI assistant across every channel — {s.providers.default_llm} · embeddings {s.providers.default_embedding}</p></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Conversations" value={d.kpi.conversations ?? 0} />
        <Stat label="Escalated" value={d.kpi.escalated ?? 0} accent="#DC9950" />
        <Stat label="Follow-ups due" value={d.kpi.follow_ups ?? 0} accent={Number(d.kpi.follow_ups) ? '#e0a050' : undefined} />
        <Stat label="Avg rating" value={d.kpi.avg_rating ?? '—'} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="KB documents" value={s.counts.documents} sub={`${s.counts.chunks} chunks`} />
        <Stat label="Workflows" value={s.counts.workflows} />
        <Stat label="Functions" value={s.counts.functions} />
        <Stat label="Channels" value={s.counts.channels} />
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Section title="Routing by workflow">
          {(!d.byWorkflow?.length) ? <Empty>No conversations yet — try the Test Lab.</Empty> : (
            <div className="space-y-2">
              {d.byWorkflow.map((w: any) => (
                <div key={w.routed_workflow} className="flex items-center justify-between text-sm">
                  <span className="text-[#cdd8d0]">{w.routed_workflow}</span>
                  <span className="text-[#7d8f83]">{w.n} turns · conf {w.conf ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Recent conversations" actions={<button className="text-xs text-[#7d8f83] hover:text-white" onClick={() => onOpen('conversations')}>View all</button>}>
          {(!d.recent?.length) ? <Empty>No conversations yet.</Empty> : (
            <div className="space-y-2">
              {d.recent.slice(0, 8).map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 text-sm py-1">
                  <span className="tag" style={{ background: '#1c2b23', color: '#9fd0b4' }}>{c.channel_type}</span>
                  <span className="flex-1 truncate text-[#cdd8d0]">{c.first_message || '(no message)'}</span>
                  {c.escalated && <span className="tag" style={{ background: '#3a2a17', color: '#e0a050' }}>escalated</span>}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
