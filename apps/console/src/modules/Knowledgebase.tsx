import { useRef, useState } from 'react';
import { Globe, Upload, RefreshCw, Search, Trash2, FileText } from 'lucide-react';
import { api } from '../api';
import { Section, useAsync, Spinner, Empty, Modal } from '../ui';

export function Knowledgebase() {
  const docs = useAsync<any>(() => api('/platform/kb/documents'), []);
  const [busy, setBusy] = useState('');
  const [testOpen, setTestOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const indexWebsite = async () => { setBusy('web'); try { await api('/platform/kb/index-website', { method: 'POST', json: {} }); alert('Website + product indexing queued. Refresh in a moment.'); } finally { setBusy(''); setTimeout(() => docs.reload(), 3000); } };
  const upload = async (f: File) => { setBusy('up'); try { const fd = new FormData(); fd.append('file', f); await fetch('/api/platform/kb/upload', { method: 'POST', body: fd, credentials: 'include' }); alert('Uploaded — indexing in the background.'); } finally { setBusy(''); setTimeout(() => docs.reload(), 2500); } };
  const del = async (id: string) => { if (!confirm('Delete this document and its chunks?')) return; await api(`/platform/kb/documents/${id}`, { method: 'DELETE' }); docs.reload(); };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div><h1 className="font-serif text-2xl">Knowledgebase</h1><p className="text-sm text-[#7d8f83] mt-1">Grounding for every channel. Structured data (prices, stock, orders) always comes from live functions — the KB holds guides, benefits and policies.</p></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button className="card p-4 text-left hover:border-[#2f6d48] transition" onClick={indexWebsite} disabled={busy === 'web'}>
          <Globe className="w-5 h-5 text-[#9fd0b4] mb-2" /><div className="text-sm font-semibold">Index entire website</div><div className="text-xs text-[#7d8f83] mt-0.5">{busy === 'web' ? 'Queuing…' : 'Crawl pages + sync products'}</div>
        </button>
        <button className="card p-4 text-left hover:border-[#2f6d48] transition" onClick={() => fileRef.current?.click()} disabled={busy === 'up'}>
          <Upload className="w-5 h-5 text-[#9fd0b4] mb-2" /><div className="text-sm font-semibold">Upload files</div><div className="text-xs text-[#7d8f83] mt-0.5">PDF, DOCX, XLSX, CSV, MD, HTML</div>
          <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.txt,.md,.html,.csv,.xlsx" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </button>
        <button className="card p-4 text-left hover:border-[#2f6d48] transition" onClick={() => setTestOpen(true)}>
          <Search className="w-5 h-5 text-[#9fd0b4] mb-2" /><div className="text-sm font-semibold">Test retrieval</div><div className="text-xs text-[#7d8f83] mt-0.5">See what the AI would find</div>
        </button>
        <button className="card p-4 text-left hover:border-[#2f6d48] transition" onClick={() => docs.reload()}>
          <RefreshCw className="w-5 h-5 text-[#9fd0b4] mb-2" /><div className="text-sm font-semibold">Refresh</div><div className="text-xs text-[#7d8f83] mt-0.5">Reload document list</div>
        </button>
      </div>
      <Section title={`Documents ${docs.data ? `(${docs.data.documents.length})` : ''}`}>
        {docs.loading ? <div className="text-[#7d8f83]"><Spinner /></div> : !docs.data?.documents.length ? <Empty>No documents yet. Index the website to start.</Empty> : (
          <div className="divide-y divide-[#1c2822]">
            {docs.data.documents.map((d: any) => (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <FileText className="w-4 h-4 text-[#7d8f83] shrink-0" />
                <div className="flex-1 min-w-0"><div className="text-sm truncate text-[#cdd8d0]">{d.title}</div><div className="text-[11px] text-[#7d8f83]">{d.chunk_count} chunks · {d.language} · {(d.tags || []).join(', ') || 'untagged'}</div></div>
                <span className="tag" style={{ background: d.status === 'indexed' ? '#1c2b23' : '#2a2a17', color: d.status === 'indexed' ? '#9fd0b4' : '#e0a050' }}>{d.status}</span>
                <button className="text-[#7d8f83] hover:text-red-400" onClick={() => del(d.id)}><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </Section>
      {testOpen && <TestRetrieval onClose={() => setTestOpen(false)} />}
    </div>
  );
}

function TestRetrieval({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState(''); const [hits, setHits] = useState<any[] | null>(null); const [busy, setBusy] = useState(false);
  const run = async () => { if (!q.trim()) return; setBusy(true); try { const r = await api('/platform/kb/test-retrieval', { method: 'POST', json: { query: q, topK: 6 } }); setHits(r.hits); } finally { setBusy(false); } };
  return (
    <Modal title="Test retrieval" onClose={onClose} wide>
      <div className="flex gap-2 mb-4"><input className="input" placeholder="Ask a customer-style question…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} /><button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? <Spinner /> : 'Search'}</button></div>
      {hits && (hits.length ? hits.map((h, i) => (
        <div key={i} className="card p-3 mb-2"><div className="flex items-center justify-between text-xs mb-1"><span className="text-[#9fd0b4] font-semibold">{h.title}</span><span className="text-[#7d8f83]">score {h.score} · vec {h.vector} · kw {h.keyword}</span></div><div className="text-xs text-[#a9b7ad]">{h.snippet}</div></div>
      )) : <Empty>No matches — try different words.</Empty>)}
    </Modal>
  );
}
