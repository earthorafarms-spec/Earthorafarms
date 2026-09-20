/** Data/tool boundary for the MSH SunPath-style LiveKit worker. No inference here. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { badRequest, notFound, unauthorized } from '../../lib/errors.js';
import { getChannelByKey, publishedConfig } from './config.js';
import { appendMessage, loadConversation, saveState } from '../engine/conversation.js';
import { BUILTIN_MAP, toolDefsFor } from '../engine/functions.js';
import { withVoiceScope } from '../providers/voiceScope.js';
import { VoiceTurnQueue } from './voiceTurns.js';
import { listProducts } from '../../modules/commerce/pricing.js';
import { approvedVoiceProductKnowledge, indexedVoiceKnowledge, searchVoiceKnowledge, voiceCatalogIds } from './sunpathKnowledge.js';

const identifier = z.string().min(1).max(180).regex(/^[a-zA-Z0-9:_-]+$/);
const common = z.object({ session_id: identifier, channel_key: z.string().min(1).max(180), channel: z.enum(['web', 'phone']) });
const tools = ['list_products', 'get_product_details', 'search_knowledge', 'add_to_cart', 'update_cart', 'get_cart', 'set_customer_detail', 'create_checkout_link', 'get_order_status', 'capture_callback'];
const toolInput = common.extend({ call_id: identifier, name: z.enum(tools as [string, ...string[]]), arguments: z.record(z.unknown()) });
const recordInput = common.extend({ message_id: identifier, role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(8000), language: z.enum(['en', 'hi', 'gu']) });

function authenticate(req: FastifyRequest): void {
  const expected = Buffer.from(config.EARTHORA_VOICE_INTERNAL_KEY);
  const header = req.headers.authorization || '';
  const actual = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  if (!expected.length || !/^Bearer\s+/i.test(header) || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw unauthorized();
}

function validateArguments(schema: Record<string, unknown>, values: Record<string, unknown>): void {
  const properties = (schema.properties || {}) as Record<string, { type?: string; enum?: unknown[]; minimum?: number }>;
  const required = (schema.required || []) as string[];
  if (required.some(key => values[key] === undefined) || Object.keys(values).some(key => !Object.hasOwn(properties, key))) throw badRequest('Invalid tool arguments');
  for (const [key, value] of Object.entries(values)) {
    const rule = properties[key];
    if ((rule.type === 'string' && (typeof value !== 'string' || value.length > 2000)) ||
        (rule.type === 'integer' && (!Number.isInteger(value) || Number(value) < (rule.minimum ?? 0) || Number(value) > 50)) ||
        (rule.enum && !rule.enum.includes(value))) throw badRequest('Invalid tool arguments');
  }
}

function normalizeCallbackArguments(values: Record<string, unknown>, conversation: Awaited<ReturnType<typeof loadConversation>>): { ok: true; arguments: Record<string, unknown> } | { ok: false; message: string } {
  const reason = String(values.reason ?? '').trim();
  if (!reason) return { ok: false, message: 'Ask the customer what they would like the callback to cover before recording it.' };
  // An explicitly supplied invalid number must not silently use an older one.
  const suppliedPhone = values.phone !== undefined;
  const original = suppliedPhone ? values.phone : conversation.state.checkout.phone || conversation.contact.phone;
  let phone = String(original ?? '').trim().replace(/[०-९૦-૯]/g, digit => String(digit.charCodeAt(0) - (digit >= '૦' ? 0x0ae6 : 0x0966)));
  if (!/^[+\d\s().-]+$/.test(phone)) return { ok: false, message: 'Ask the customer for a valid callback phone number before recording the request.' };
  phone = phone.replace(/[\s().-]/g, '');
  if (phone.startsWith('00')) phone = '+' + phone.slice(2);
  if (/^0[1-9]\d{9}$/.test(phone)) phone = phone.slice(1);
  if (/^[1-9]\d{9}$/.test(phone)) phone = '+91' + phone;
  else if (/^91[1-9]\d{9}$/.test(phone)) phone = '+' + phone;
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || (phone.startsWith('+91') && !/^\+91[1-9]\d{9}$/.test(phone))) {
    return { ok: false, message: 'Ask the customer for a valid callback phone number, including the country code when outside India.' };
  }
  const name = String(values.name ?? conversation.state.checkout.name ?? conversation.contact.name ?? '').trim();
  return { ok: true, arguments: { ...values, reason, phone, ...(name ? { name } : {}) } };
}

function nativeToolDefinitions() {
  return toolDefsFor(tools).map(tool => tool.name === 'search_knowledge' ? {
    ...tool,
    description: 'Search approved Earthora knowledge for product facts, ingredients, benefits, directions and policies. Submit concise English semantic keywords in query, translating Hindi or Gujarati search intent into English keywords. Keep canonical product names unchanged. Answer the customer in their current language; only the search query uses English.',
  } : tool);
}

export async function sunpathRoutes(app: FastifyInstance): Promise<void> {
  const queue = new VoiceTurnQueue();
  async function resolve(data: z.infer<typeof common>) {
    const ch = await getChannelByKey(data.channel_key);
    if (!ch || ch.type !== 'voice' || !ch.enabled || (data.channel === 'phone' && ch.public_key !== config.VOICE_PHONE_CHANNEL_KEY)) throw notFound('Voice channel unavailable');
    const channelType = data.channel === 'phone' ? 'calls' : 'voice';
    // loadConversation's unique identity omits channel_id. Namespace the public
    // session ID so two voice channels cannot accidentally share cart/history.
    const externalId = 'sunpath_' + createHash('sha256').update(JSON.stringify([ch.id, data.channel, data.session_id])).digest('hex');
    const conversation = await loadConversation({ tenantId: ch.tenant_id, channelId: ch.id, channelType, externalId });
    return { ch, conversation, channelType };
  }
  function serial<T>(data: z.infer<typeof common>, operation: string, content: unknown, work: () => Promise<T>) {
    return queue.run(`${data.channel_key}:${data.channel}:${data.session_id}`, operation, createHash('sha256').update(JSON.stringify(content)).digest('hex'), work);
  }

  app.post('/platform/voice/internal/context', { preHandler: async (req) => authenticate(req) }, async (req) => {
    const parsed = common.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid voice context');
    const { ch, conversation: conv, channelType } = await resolve(parsed.data);
    const cfg = publishedConfig(ch);
    const catalog = await withVoiceScope(ch.tenant_id, () => BUILTIN_MAP.get('list_products')!.run({}, { conversationId: conv.id, channelType, state: conv.state, contact: conv.contact }));
    const [canonical, indexed] = await Promise.all([
      approvedVoiceProductKnowledge(ch.tenant_id, voiceCatalogIds(catalog.ok ? catalog.data : [])),
      indexedVoiceKnowledge(ch.tenant_id),
    ]);
    const knowledge = [...canonical, ...indexed];
    return { persona: { ...(cfg.persona || {}), name: cfg.name || 'Eva' }, language: conv.state.language, history: conv.history.slice(-8),
      catalog: catalog.ok ? catalog.data : [], knowledge, tools: nativeToolDefinitions(), cart: conv.state.cart, checkout: conv.state.checkout };
  });

  app.post('/platform/voice/internal/tool', { preHandler: async (req) => authenticate(req) }, async (req) => {
    const parsed = toolInput.safeParse(req.body);
    if (!parsed.success || JSON.stringify(parsed.data.arguments).length > 12000) throw badRequest('Invalid voice tool');
    const data = parsed.data;
    return serial(data, `tool:${data.call_id}`, [data.name, data.arguments], async () => {
      const { ch, conversation: conv, channelType } = await resolve(data);
      const fn = BUILTIN_MAP.get(data.name);
      if (!fn) throw badRequest('Unsupported voice tool');
      validateArguments(fn.parameters, data.arguments);
      if (data.name === 'search_knowledge') {
        const products = await withVoiceScope(ch.tenant_id, () => listProducts());
        const activeIds = products.filter(product => product.status === 'active').map(product => product.id);
        const requestedId = data.arguments.productId;
        if (requestedId !== undefined && !activeIds.includes(String(requestedId))) {
          return { ok: false, message: 'Unknown product ID. Use an exact current catalogue id for product knowledge.' };
        }
        const ids = requestedId === undefined ? activeIds : [String(requestedId)];
        return { ok: true, data: await withVoiceScope(ch.tenant_id, () => searchVoiceKnowledge(ch.tenant_id, ids, String(data.arguments.query))) };
      }
      if (data.name === 'capture_callback') {
        const normalized = normalizeCallbackArguments(data.arguments, conv);
        if (!normalized.ok) return normalized;
        Object.assign(data.arguments, normalized.arguments);
      }
      if (['add_to_cart', 'update_cart', 'get_product_details'].includes(data.name)) {
        // The legacy tool accepts fuzzy names and even falls back to the only
        // product. Native tools must use an exact ID returned by the catalogue.
        const productId = data.arguments.productId;
        const products = await withVoiceScope(ch.tenant_id, () => listProducts());
        if (typeof productId !== 'string' || !productId.trim() || !products.some(p => p.id === productId && p.status === 'active')) {
          return { ok: false, message: 'Unknown product ID. Use list_products and the exact returned id; clarify ambiguous product names before changing the cart.' };
        }
      }
      // The concrete tool validates catalogue, required fields and identity.
      // Only these named tools are exposed; no arbitrary URLs, SQL or functions.
      const result = await withVoiceScope(ch.tenant_id, () => fn.run(data.arguments, { conversationId: conv.id, channelType, state: conv.state, contact: conv.contact }));
      await saveState(conv.id, conv.state);
      return result;
    });
  });

  app.post('/platform/voice/internal/record', { preHandler: async (req) => authenticate(req) }, async (req) => {
    const parsed = recordInput.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid voice transcript');
    const data = parsed.data;
    return serial(data, `record:${data.message_id}`, [data.role, data.text, data.language], async () => {
      const { conversation: conv } = await resolve(data);
      await appendMessage(conv.id, data.role, data.text);
      conv.state.language = data.language;
      await saveState(conv.id, conv.state);
      return { ok: true };
    });
  });
}
