import { useState } from 'react';
import { Sparkles, Plus, ChevronRight } from 'lucide-react';
import { api } from '../api';
import { Section, useAsync, Spinner, Empty, Modal } from '../ui';

export function Workflows() {
  const list = useAsync<any>(() => api('/platform/workflows'), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div><h1 className="font-serif text-2xl">Workflows</h1><p className="text-sm text-[#7d8f83] mt-1">The core USP. Each workflow is a scenario playbook — when to use it, what to ask, what to retrieve, which tools it may call. Different conversations, different behaviour.</p></div>
        <button className="btn btn-primary" onClick={() => setDrafting(true)}><Sparkles className="w-4 h-4" /> Draft with AI</button>
      </div>
      <Section title={`Workflows ${list.data ? `(${list.data.workflows.length})` : ''}`}>
        {list.loading ? <div className="text-[#7d8f83]"><Spinner /></div> : (
          <div className="divide-y divide-[#1c2822]">
            {list.data.workflows.map((w: any) => (
              <button key={w.id} className="w-full flex items-center gap-3 py-3 text-left hover:bg-[#161f1a] -mx-2 px-2 rounded-lg transition" onClick={() => setOpenId(w.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="text-sm text-[#cdd8d0]">{w.name}</span><span className="tag" style={{ background: w.mode === 'stepped' ? '#2a2117' : '#1c2b23', color: w.mode === 'stepped' ? '#e0a050' : '#9fd0b4' }}>{w.mode}</span>{w.is_fallback && <span className="tag" style={{ background: '#252525', color: '#9aa' }}>fallback</span>}</div>
                  <div className="text-xs text-[#7d8f83] mt-0.5 truncate">{w.description}</div>
                </div>
                <span className="tag" style={{ background: w.status === 'published' ? '#1c2b23' : '#2a2a17', color: w.status === 'published' ? '#9fd0b4' : '#e0a050' }}>{w.status}</span>
                <ChevronRight className="w-4 h-4 text-[#7d8f83]" />
              </button>
            ))}
          </div>
        )}
      </Section>
      {openId && <WorkflowEditor id={openId} onClose={() => { setOpenId(null); list.reload(); }} />}
      {drafting && <DraftModal onClose={() => setDrafting(false)} onCreated={() => { setDrafting(false); list.reload(); }} />}
    </div>
  );
}

function WorkflowEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const wf = useAsync<any>(() => api(`/platform/workflows/${id}`), [id]);
  const [ex, setEx] = useState(''); const [busy, setBusy] = useState(false);
  if (wf.loading || !wf.data) return <Modal title="Workflow" onClose={onClose}><Spinner /></Modal>;
  const w = wf.data.workflow; const def = w.definition || {};
  const addExample = async () => { if (!ex.trim()) return; setBusy(true); try { await api(`/platform/workflows/${id}/examples`, { method: 'POST', json: { text: ex } }); setEx(''); wf.reload(); } finally { setBusy(false); } };
  const publish = async () => { setBusy(true); try { await api(`/platform/workflows/${id}/publish`, { method: 'POST' }); alert('Published — examples are being re-embedded.'); wf.reload(); } finally { setBusy(false); } };
  return (
    <Modal title={w.name} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div><div className="text-[11px] uppercase tracking-wider text-[#7d8f83] mb-1">When to use</div><div className="text-[#cdd8d0]">{w.description}</div></div>
        {def.slots?.length ? <div><div className="text-[11px] uppercase tracking-wider text-[#7d8f83] mb-1">Collects</div>{def.slots.map((s: any) => <div key={s.key} className="text-[#cdd8d0]">• <b>{s.key}</b>{s.required ? ' (required)' : ''} — “{s.question?.en}”</div>)}</div> : null}
        {def.prompt?.playbook?.length ? <div><div className="text-[11px] uppercase tracking-wider text-[#7d8f83] mb-1">Playbook</div>{def.prompt.playbook.map((p: string, i: number) => <div key={i} className="text-[#cdd8d0]">{i + 1}. {p}</div>)}</div> : null}
        <div><div className="text-[11px] uppercase tracking-wider text-[#7d8f83] mb-1">Tools</div><div className="flex flex-wrap gap-1.5">{(def.tools || []).map((t: any) => <span key={t.function} className="tag" style={{ background: '#1c2b23', color: '#9fd0b4' }}>{t.function}</span>)}</div></div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-[#7d8f83] mb-1">Example utterances ({wf.data.examples.length})</div>
          <div className="flex flex-wrap gap-1.5 mb-2">{wf.data.examples.map((e: any) => <span key={e.id} className="tag" style={{ background: e.kind === 'negative' ? '#2a1717' : '#151f18', color: e.kind === 'negative' ? '#e08080' : '#a9b7ad' }}>{e.text}</span>)}</div>
          <div className="flex gap-2"><input className="input" placeholder="Add a customer utterance that should route here…" value={ex} onChange={(e) => setEx(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addExample()} /><button className="btn btn-ghost" onClick={addExample} disabled={busy}><Plus className="w-4 h-4" /></button></div>
        </div>
        <div className="flex justify-end pt-2"><button className="btn btn-primary" onClick={publish} disabled={busy}>{busy ? <Spinner /> : 'Publish version'}</button></div>
      </div>
    </Modal>
  );
}

function DraftModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [desc, setDesc] = useState(''); const [draft, setDraft] = useState<any>(null); const [busy, setBusy] = useState(false);
  const gen = async () => { setBusy(true); try { const r = await api('/platform/workflows/draft', { method: 'POST', json: { description: desc } }); setDraft(r.draft); } catch (e: any) { alert(e.message); } finally { setBusy(false); } };
  const create = async () => { setBusy(true); try { const w = await api('/platform/workflows', { method: 'POST', json: { slug: draft.slug || draft.name?.toLowerCase().replace(/\s+/g, '-'), name: draft.name, description: draft.description, mode: draft.mode || 'playbook' } }); await api(`/platform/workflows/${w.workflow.id}`, { method: 'PATCH', json: { definition: draft } }); for (const ex of (draft.triggers?.examples || [])) await api(`/platform/workflows/${w.workflow.id}/examples`, { method: 'POST', json: { text: ex } }); await api(`/platform/workflows/${w.workflow.id}/publish`, { method: 'POST' }); onCreated(); } catch (e: any) { alert(e.message); } finally { setBusy(false); } };
  return (
    <Modal title="Draft a workflow with AI" onClose={onClose} wide>
      <p className="text-xs text-[#7d8f83] mb-2">Describe the scenario in plain words. The assistant drafts the structured workflow — you review and publish.</p>
      <textarea className="input" placeholder="e.g. When a customer asks about bulk or wholesale orders, collect their business name, quantity and city, then capture a callback for the sales team." value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="flex justify-end mt-2"><button className="btn btn-primary" onClick={gen} disabled={busy || desc.length < 8}>{busy ? <Spinner /> : <><Sparkles className="w-4 h-4" /> Generate</>}</button></div>
      {draft && (
        <div className="mt-4 card p-3">
          <div className="text-sm font-semibold text-[#cdd8d0]">{draft.name} <span className="tag ml-1" style={{ background: '#1c2b23', color: '#9fd0b4' }}>{draft.mode}</span></div>
          <div className="text-xs text-[#7d8f83] mt-1">{draft.description}</div>
          {draft.slots?.length ? <div className="text-xs text-[#a9b7ad] mt-2">Asks: {draft.slots.map((s: any) => s.key).join(', ')}</div> : null}
          <div className="text-xs text-[#a9b7ad] mt-1">Examples: {(draft.triggers?.examples || []).join(' · ')}</div>
          <div className="flex justify-end mt-3"><button className="btn btn-primary" onClick={create} disabled={busy}>Create & publish</button></div>
        </div>
      )}
    </Modal>
  );
}
