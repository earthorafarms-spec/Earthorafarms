import { api } from '../api';
import { Section, useAsync, Spinner, Toggle } from '../ui';
import { useState } from 'react';

export function Functions() {
  const list = useAsync<any>(() => api('/platform/functions'), []);
  const [saving, setSaving] = useState('');
  const toggle = async (f: any, key: 'enabled' | 'requires_confirmation', v: boolean) => { setSaving(f.id + key); try { await api(`/platform/functions/${f.id}`, { method: 'PATCH', json: { [key]: v } }); list.reload(); } finally { setSaving(''); } };
  return (
    <div className="space-y-6">
      <div><h1 className="font-serif text-2xl">Functions</h1><p className="text-sm text-[#7d8f83] mt-1">The tools the AI can call for live facts and actions. Code-maintained in v1 — enable, disable, edit the model-facing description, or require confirmation.</p></div>
      <Section title={`Registry ${list.data ? `(${list.data.functions.length})` : ''}`}>
        {list.loading ? <div className="text-[#7d8f83]"><Spinner /></div> : (
          <div className="divide-y divide-[#1c2822]">
            {list.data.functions.map((f: any) => (
              <div key={f.id} className="py-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><code className="text-sm text-[#9fd0b4]">{f.name}</code>{f.requires_confirmation && <span className="tag" style={{ background: '#2a2117', color: '#e0a050' }}>confirm</span>}</div>
                    <div className="text-xs text-[#7d8f83] mt-0.5">{f.description}</div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[#7d8f83]">confirm <Toggle on={f.requires_confirmation} onChange={(v) => toggle(f, 'requires_confirmation', v)} /></label>
                  <label className="flex items-center gap-2 text-xs text-[#7d8f83]">{saving === f.id + 'enabled' ? <Spinner /> : (f.enabled ? 'on' : 'off')} <Toggle on={f.enabled} onChange={(v) => toggle(f, 'enabled', v)} /></label>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
