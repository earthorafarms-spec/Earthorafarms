import { sql } from '../../db/client.js';
import type { EngineState } from './engine.js';

export interface LoadedConversation { id: string; state: EngineState; history: { role: string; content: string }[]; contact: { phone?: string; email?: string; name?: string; verified?: boolean } }

const emptyState = (language = 'en'): EngineState => ({ slots: {}, cart: [], checkout: {}, language, summary: '' });

/** Finds or creates a conversation by (channelType, externalId) and returns its durable state + recent history. */
export async function loadConversation(input: { tenantId: string; channelType: string; externalId: string; channelId?: string | null; contact?: { phone?: string; email?: string; name?: string } }): Promise<LoadedConversation> {
  const [conv] = await sql<any[]>`
    INSERT INTO conversations (tenant_id, channel_type, external_id, channel_id, language)
    VALUES (${input.tenantId}, ${input.channelType}, ${input.externalId}, ${input.channelId ?? null}, 'en')
    ON CONFLICT (tenant_id, channel_type, external_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
    RETURNING id`;
  const convId = conv.id;
  await sql`INSERT INTO conversation_state (conversation_id) VALUES (${convId}) ON CONFLICT (conversation_id) DO NOTHING`;
  const [st] = await sql<any[]>`SELECT * FROM conversation_state WHERE conversation_id = ${convId}`;
  const history = await sql<any[]>`SELECT role, content FROM messages WHERE conversation_id = ${convId} AND role IN ('user','assistant') ORDER BY seq DESC LIMIT 16`;
  const state: EngineState = {
    activeWorkflowId: st.active_workflow_id ?? undefined, activeWorkflowSlug: undefined,
    slots: st.slots ?? {}, cart: st.cart ?? [], checkout: st.checkout ?? {}, language: st.language ?? 'en', summary: st.summary ?? '', pendingSlot: st.pending?.slot ?? null,
  };
  let contact: LoadedConversation['contact'] = {};
  if (input.contact?.phone || input.contact?.email) {
    const [c] = await sql<any[]>`INSERT INTO contacts (tenant_id, phone, email, name) VALUES (${input.tenantId}, ${input.contact.phone ?? null}, ${input.contact.email ?? null}, ${input.contact.name ?? null})
      ON CONFLICT (tenant_id, phone) DO UPDATE SET email = COALESCE(EXCLUDED.email, contacts.email), name = COALESCE(EXCLUDED.name, contacts.name) RETURNING id, phone, email, name, verified_at`;
    if (c) { contact = { phone: c.phone, email: c.email, name: c.name, verified: Boolean(c.verified_at) }; await sql`UPDATE conversations SET contact_id = ${c.id} WHERE id = ${convId}`; }
  }
  return { id: convId, state: { ...emptyState(), ...state }, history: history.reverse(), contact };
}

export async function appendMessage(conversationId: string, role: string, content: string, extra: { toolCalls?: unknown; latencyMs?: number } = {}): Promise<void> {
  await sql`INSERT INTO messages (conversation_id, role, content, tool_calls, latency_ms) VALUES (${conversationId}, ${role}, ${content}, ${extra.toolCalls ? sql.json(extra.toolCalls as any) : null}, ${extra.latencyMs ?? null})`;
}

export async function saveState(conversationId: string, state: EngineState): Promise<void> {
  await sql`UPDATE conversation_state SET active_workflow_id = ${state.activeWorkflowId ?? null}, slots = ${sql.json(state.slots as any)}, cart = ${sql.json(state.cart as any)},
    checkout = ${sql.json(state.checkout as any)}, pending = ${state.pendingSlot ? sql.json({ slot: state.pendingSlot } as any) : null}, language = ${state.language}, summary = ${state.summary},
    revision = revision + 1, updated_at = now() WHERE conversation_id = ${conversationId}`;
}

export async function endConversation(conversationId: string): Promise<void> {
  await sql`UPDATE conversations SET status = 'ended', ended_at = now() WHERE id = ${conversationId} AND status = 'active'`;
}
