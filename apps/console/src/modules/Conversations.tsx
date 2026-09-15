import { useState } from 'react';
import { api } from '../api';
import { Section, useAsync, Spinner, Empty, Modal } from '../ui';

export function Conversations() {
  const list = useAsync<any>(() => api('/platform/dashboard'), []);
  const esc = useAsync<any>(() => api('/platform/escalations'), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const resolve = async (id: string) => { await api(`/platform/escalations/${id}/resolve`, { method: 'POST', json: {} }); esc.reload(); };
  return (
    <div className="space-y-6">
      <div><h1 className="font-serif text-2xl">Conversations</h1><p className="text-sm text-[#7d8f83] mt-1">Every conversation with its transcript, routing trace and evidence. Callbacks the AI captured appear as follow-ups.</p></div>
      <Section title="Follow-up queue">
        {esc.loading ? <Spinner /> : !esc.data?.escalations.filter((e: any) => e.status === 'open').length ? <Empty>No open callbacks.</Empty> : (
          <div className="divide-y divide-[#1c2822]">
            {esc.data.escalations.filter((e: any) => e.status === 'open').map((e: any) => (
              <div key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="tag" style={{ background: '#2a2117', color: '#e0a050' }}>{e.kind}</span>
                <div className="flex-1 min-w-0"><div className="text-[#cdd8d0] truncate">{e.contact?.name || 'Customer'} · {e.contact?.phone || e.contact?.email || ''}</div><div className="text-xs text-[#7d8f83] truncate">{e.payload?.reason || ''}</div></div>
                <button className="btn btn-ghost h-8" onClick={() => resolve(e.id)}>Resolve</button>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="Recent conversations">
        {list.loading ? <Spinner /> : !list.data?.recent.length ? <Empty>No conversations yet.</Empty> : (
          <div className="divide-y divide-[#1c2822]">
            {list.data.recent.map((c: any) => (
              <button key={c.id} className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-[#161f1a] -mx-2 px-2 rounded-lg" onClick={() => setOpenId(c.id)}>
                <span className="tag" style={{ background: '#1c2b23', color: '#9fd0b4' }}>{c.channel_type}</span>
                <span className="flex-1 truncate text-sm text-[#cdd8d0]">{c.first_message || '(no message)'}</span>
                <span className="text-xs text-[#7d8f83]">{c.language}</span>
                {c.rating && <span className="text-xs text-[#DC9950]">★ {c.rating}</span>}
                {c.escalated && <span className="tag" style={{ background: '#3a2a17', color: '#e0a050' }}>escalated</span>}
              </button>
            ))}
          </div>
        )}
      </Section>
      {openId && <ConversationDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ConversationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useAsync<any>(() => api(`/platform/conversations/${id}`), [id]);
  return (
    <Modal title="Conversation" onClose={onClose} wide>
      {d.loading || !d.data ? <Spinner /> : (
        <div className="space-y-4">
          <div className="space-y-2">
            {d.data.messages.map((m: any, i: number) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${m.role === 'user' ? 'bg-[#2f6d48] text-white' : m.role === 'tool' ? 'bg-[#241f14] text-[#c9b98f] text-xs font-mono' : 'bg-[#1a2620] text-[#cdd8d0]'}`}>
                  {m.role === 'tool' ? `🔧 ${(m.tool_calls?.[0]?.name) || 'tool'}` : m.content}
                </div>
              </div>
            ))}
          </div>
          <div className="card p-3">
            <div className="text-[11px] uppercase tracking-wider text-[#7d8f83] mb-2">Routing trace</div>
            {d.data.traces.map((t: any, i: number) => (
              <div key={i} className="text-xs text-[#a9b7ad] mb-1">→ <b className="text-[#9fd0b4]">{t.routed_workflow}</b> (conf {t.router_confidence ?? '—'}) · {t.router_reason} {t.retrieval?.evidence?.length ? `· ${t.retrieval.evidence.length} sources` : ''} {t.timings?.total ? `· ${t.timings.total}ms` : ''}</div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
