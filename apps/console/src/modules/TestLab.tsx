import { useEffect, useRef, useState } from 'react';
import { Send, Bot } from 'lucide-react';
import { api } from '../api';
import { Spinner } from '../ui';

interface Msg { role: 'user' | 'assistant'; text: string; workflow?: string; sources?: { title: string }[] }

/** Live simulation against the published chat channel — the same engine customers use. */
export function TestLab() {
  const [key, setKey] = useState<string>('');
  const [conv, setConv] = useState<string | undefined>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { api('/platform/channels').then((r) => { const c = r.channels.find((x: any) => x.type === 'chat'); if (c) setKey(c.public_key); }); }, []);
  useEffect(() => { scroller.current?.scrollTo(0, scroller.current.scrollHeight); }, [msgs]);

  const send = async () => {
    if (!input.trim() || busy || !key) return;
    const text = input.trim(); setInput(''); setMsgs((m) => [...m, { role: 'user', text }]); setBusy(true);
    setMsgs((m) => [...m, { role: 'assistant', text: '' }]);
    try {
      const res = await fetch('/api/platform/chat/send', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelKey: key, conversationId: conv, message: text }) });
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); const parts = buf.split('\n\n'); buf = parts.pop() || '';
        for (const p of parts) {
          const ev = p.match(/event: (\w+)/)?.[1]; const data = p.match(/data: (.+)/s)?.[1]; if (!data) continue;
          const parsed = JSON.parse(data);
          if (ev === 'meta') setConv(parsed.conversationId);
          else if (ev === 'delta') setMsgs((m) => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], text: c[c.length - 1].text + parsed.text }; return c; });
          else if (ev === 'done') { setConv(parsed.conversationId); setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: 'assistant', text: parsed.reply, workflow: parsed.workflow, sources: parsed.sources }; return c; }); }
        }
      }
    } catch { setMsgs((m) => { const c = [...m]; c[c.length - 1] = { role: 'assistant', text: '(error — is the API running?)' }; return c; }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)] flex flex-col">
      <div><h1 className="font-serif text-2xl">Test Lab</h1><p className="text-sm text-[#7d8f83] mt-1">Talk to the live assistant exactly as a customer would. Each reply shows which workflow handled it and the sources used.</p></div>
      <div className="card flex-1 flex flex-col overflow-hidden">
        <div ref={scroller} className="flex-1 overflow-auto p-5 space-y-3">
          {!msgs.length && <div className="text-center text-[#7d8f83] text-sm py-10"><Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />Ask a question — try “recommend a product for energy” or “where is my order?”</div>}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm ${m.role === 'user' ? 'bg-[#2f6d48] text-white' : 'bg-[#1a2620] text-[#e8eee9]'}`}>
                {m.text || <Spinner />}
                {m.role === 'assistant' && m.workflow && <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><span className="tag" style={{ background: '#14201a', color: '#9fd0b4' }}>{m.workflow}</span>{m.sources?.slice(0, 3).map((s, j) => <span key={j} className="tag" style={{ background: '#141b17', color: '#7d8f83' }}>{s.title}</span>)}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-[#1c2822] flex gap-2">
          <input className="input" placeholder="Type a customer message…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="btn btn-primary" onClick={send} disabled={busy || !key}><Send className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
}
