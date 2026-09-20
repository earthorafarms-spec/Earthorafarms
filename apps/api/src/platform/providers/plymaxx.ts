import { config } from '../../config.js';
import type { ChatMessage, LlmAdapter, ToolCall, ToolDef } from './types.js';

const CONTEXT_TOKENS = 8192;

export function estimateTokens(text: string): number {
  const indic = (text.match(/[\u0900-\u097f\u0a80-\u0aff]/gu) || []).length;
  return Math.ceil(indic + (text.length - indic) / 4);
}

function validArguments(value: unknown, schema: Record<string, unknown>): boolean {
  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'array') return Array.isArray(value) && (!schema.items || value.every((item) => validArguments(item, schema.items as Record<string, unknown>)));
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required) && !schema.required.every((key) => typeof key === 'string' && key in obj)) return false;
    return Object.entries((schema.properties || {}) as Record<string, Record<string, unknown>>).every(([key, child]) => !(key in obj) || validArguments(obj[key], child));
  }
  return true;
}

/** Keep grounding, the latest user turn, and complete tool exchanges together. */
export function fitVoiceContext(messages: ChatMessage[], tools: ToolDef[], outputTokens: number): ChatMessage[] {
  const budget = CONTEXT_TOKENS - outputTokens - estimateTokens(JSON.stringify(tools)) - 256;
  const cost = (m: ChatMessage) => estimateTokens(JSON.stringify(m)) + 8;
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const groups: ChatMessage[][] = [];
  for (const message of rest) {
    const last = groups.at(-1);
    if (message.role === 'tool' && last?.[0].role === 'assistant' && last[0].tool_calls?.length) last.push(message);
    else groups.push([message]);
  }
  // Retain the current user question and every tool result produced for it.
  let latestUser = groups.findLastIndex((g) => g[0].role === 'user');
  if (latestUser < 0) latestUser = Math.max(0, groups.length - 1);
  let start = latestUser;
  let used = [...system, ...groups.slice(start).flat()].reduce((n, m) => n + cost(m), 0);
  if (used > budget) throw new Error('Voice grounding exceeds the model context budget');
  while (start > 0) {
    const additional = groups[start - 1].reduce((n, m) => n + cost(m), 0);
    if (used + additional > budget) break;
    used += additional; start--;
  }
  return [...system, ...groups.slice(start).flat()];
}

export const plymaxxVoiceLlm: LlmAdapter = {
  name: 'plymaxx',
  async chat(messages, opts = {}) {
    if (!config.AI_BASE_URL || !config.AI_API_KEY) throw new Error('Voice AI is not configured');
    const maxTokens = Math.max(16, Math.min(256, opts.maxTokens ?? 256));
    const fitted = fitVoiceContext(messages, opts.tools || [], maxTokens);
    const wire = fitted.map((m) => m.role === 'assistant' && m.tool_calls?.length
      ? { role: m.role, content: m.content || null, tool_calls: m.tool_calls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })) }
      : m.role === 'tool' ? { role: m.role, content: m.content, tool_call_id: m.tool_call_id } : { role: m.role, content: m.content });
    const response = await fetch(`${config.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.AI_API_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: config.AI_LLM_MODEL, messages: wire,
        tools: opts.tools?.length ? opts.tools.map((t) => ({ type: 'function', function: t })) : undefined,
        tool_choice: opts.tools?.length ? 'auto' : undefined,
        temperature: opts.temperature ?? 0.2, max_tokens: maxTokens, stream: false,
        think: false, thinking: false, chat_template_kwargs: { enable_thinking: false },
        response_format: opts.json ? { type: 'json_object' } : undefined,
      }),
    });
    if (!response.ok) throw new Error(`Voice AI returned HTTP ${response.status}`);
    const body = await response.json() as {
      model?: string;
      choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
    };
    const choice = body.choices?.[0];
    if (!choice?.message) throw new Error('Voice AI returned no message');
    // A cut-off tool call must never execute with guessed or empty arguments.
    if (choice.finish_reason === 'length') throw new Error('Voice AI response exceeded its output limit');
    const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map((tc, i) => {
      if (!tc.function?.name || !opts.tools?.some((t) => t.name === tc.function!.name)) throw new Error('Voice AI returned an unavailable tool');
      const args: unknown = JSON.parse(tc.function.arguments?.trim() || '{}');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Voice AI returned invalid tool arguments');
      const tool = opts.tools!.find((t) => t.name === tc.function!.name)!;
      if (!validArguments(args, tool.parameters)) throw new Error('Voice AI returned arguments outside the tool schema');
      return { id: tc.id || `voice_call_${i}`, name: tc.function.name, arguments: args as Record<string, unknown> };
    });
    const text = (choice.message.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!text && !toolCalls.length) throw new Error('Voice AI returned an empty response');
    return { text, toolCalls, model: body.model || config.AI_LLM_MODEL };
  },
};
