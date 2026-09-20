// Qwen3.5 9B on the self-hosted Plymaxx GPU server, behind an OpenAI-shaped
// /chat/completions endpoint.
//
// Unlike the STT/TTS adapters, this one serves ALL THREE languages: the model
// answers English, Hindi and Gujarati, so nothing has to fall back to a hosted
// vendor for text. Two server-side limits shape the implementation:
//
//   * Generation is capped at 256 tokens. Asking for more is silently clamped,
//     so a long reply comes back truncated rather than rejected — we ask for
//     the cap explicitly and log when a reply actually hits it.
//   * The context window is 8,192 tokens, which a long checkout conversation
//     can exceed. History is trimmed here, never in the conversation engine,
//     and trimming always keeps tool results attached to their tool calls.
//
// The model has no knowledge of Earthora and will confidently invent shipping
// and price claims if asked without grounding (verified: it volunteered
// "we only ship within the United States"). That is safe here only because
// conversation/controller.ts supplies catalogue/policy facts and tool results
// on every turn, and output-policy.ts checks the reply afterwards. Do not
// call this adapter outside that grounding.

import { config } from '../config.js';
import type { ConversationMessage } from '../conversation/state.js';
import type { ToolDefinition } from '../tools/types.js';
import type { LLMAdapter, LLMToolCall, LLMTurnResult } from './types.js';
import { plymaxxJson, PlymaxxRequestError } from './plymaxx-client.js';

const ADAPTER = 'PlymaxxLLMAdapter';

/**
 * True when `json` is a usable argument payload for a tool call.
 *
 * An absent or empty string is accepted and means "no arguments": tools like
 * get_cart declare `properties: {}` and are legitimately called with nothing,
 * and some servers serialize that as "" rather than "{}". Rejecting it would
 * break those tools outright. Anything non-empty must parse to a JSON object.
 */
export function isUsableToolArguments(json: string): boolean {
  if (json.trim() === '') return true;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

const CONTEXT_TOKENS = 8_192;

/**
 * Estimates tokens per script rather than with one ratio.
 *
 * Devanagari and Gujarati cost close to a token per character in a BPE
 * vocabulary; Latin text is nearer four characters per token. A single ratio
 * cannot serve both: tuning it for Indic text over-counts the English system
 * prompt so badly that trimming throws away the whole conversation, and tuning
 * it for English under-counts a Gujarati checkout and overflows the window.
 *
 * Indic characters are therefore counted at one token each (the pessimistic
 * bound) and everything else at four characters per token.
 */
export function estimateTextTokens(text: string): number {
  let indic = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    // Devanagari (Hindi) and Gujarati Unicode blocks.
    if ((code >= 0x0900 && code <= 0x097f) || (code >= 0x0a80 && code <= 0x0aff)) indic++;
  }
  return Math.ceil(indic + (text.length - indic) / 4);
}

interface ChatCompletionResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
}

type WireMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function toWireMessages(messages: ConversationMessage[]): WireMessage[] {
  return messages.map((m): WireMessage => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
    }
    if (m.role === 'assistant') {
      const calls = m.toolCalls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.argumentsJson },
      }));
      return calls?.length
        ? { role: 'assistant', content: m.content || null, tool_calls: calls }
        : { role: 'assistant', content: m.content || null };
    }
    return { role: m.role, content: m.content };
  });
}

function estimateTokens(message: ConversationMessage): number {
  const toolText = message.toolCalls?.map((tc) => tc.name + tc.argumentsJson).join('') ?? '';
  return estimateTextTokens(message.content) + estimateTextTokens(toolText) + 4;
}

/**
 * Drops the OLDEST conversational turns until the request fits the server's
 * context window, always keeping every system message (they carry the persona,
 * the language instruction and this turn's grounding facts).
 *
 * An assistant message that requested tools and the tool results answering it
 * are kept or dropped together: a tool result whose tool call has been trimmed
 * away is a malformed request, and an assistant tool call with no result would
 * make the model repeat it.
 */
export function fitToContext(
  messages: ConversationMessage[],
  reservedForOutput: number,
  toolsOverheadTokens: number,
): { messages: ConversationMessage[]; droppedCount: number } {
  const budget = CONTEXT_TOKENS - reservedForOutput - toolsOverheadTokens;
  const total = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  if (total <= budget) return { messages, droppedCount: 0 };

  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  // Group each assistant-with-tool-calls together with the tool results that
  // answer it, so a group is an all-or-nothing unit.
  const groups: ConversationMessage[][] = [];
  for (const message of rest) {
    const previous = groups[groups.length - 1];
    const continuesToolGroup =
      message.role === 'tool' &&
      previous !== undefined &&
      previous[0]?.role === 'assistant' &&
      (previous[0]?.toolCalls?.length ?? 0) > 0;
    if (continuesToolGroup) previous.push(message);
    else groups.push([message]);
  }

  let used = system.reduce((sum, m) => sum + estimateTokens(m), 0);
  if (used >= budget) {
    // System messages are never trimmed — they carry the persona, the language
    // instruction and this turn's grounding — so if they alone fill the window
    // there is nothing trimming can do, and the model would silently lose the
    // conversation. Say so instead of degrading quietly.
    // eslint-disable-next-line no-console
    console.warn(
      `[plymaxx-llm] system messages alone need ~${used} tokens of a ${budget}-token budget; ` +
        'conversation history cannot fit. Shorten the system prompt or reduce the tool set.',
    );
  }
  const kept: ConversationMessage[][] = [];
  // Walk backwards: the most recent exchanges matter most to the current turn.
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]!;
    const cost = group.reduce((sum, m) => sum + estimateTokens(m), 0);
    if (used + cost > budget && kept.length > 0) break;
    used += cost;
    kept.unshift(group);
  }

  const keptMessages = kept.flat();
  return {
    messages: [...system, ...keptMessages],
    droppedCount: rest.length - keptMessages.length,
  };
}

function toWireTools(tools: ToolDefinition[]) {
  // Deliberately no `strict: true`: the OpenAI-only flag was not accepted by
  // this server during verification, and plain function schemas produced
  // correct tool calls.
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export class PlymaxxLLMAdapter implements LLMAdapter {
  async chatWithTools(messages: ConversationMessage[], tools: ToolDefinition[]): Promise<LLMTurnResult> {
    const maxTokens = config.AI_MAX_OUTPUT_TOKENS;
    const toolsOverhead = tools.reduce(
      (sum, t) => sum + estimateTextTokens(t.name + t.description + JSON.stringify(t.parameters)),
      0,
    );
    const { messages: fitted, droppedCount } = fitToContext(messages, maxTokens, toolsOverhead);
    if (droppedCount > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[plymaxx-llm] trimmed ${droppedCount} old message(s) to fit the ${CONTEXT_TOKENS}-token context window.`);
    }

    const response = await plymaxxJson<ChatCompletionResponse>({
      adapterName: ADAPTER,
      url: '/chat/completions',
      timeoutMs: config.VOICE_LLM_TIMEOUT_MS,
      // One turn can make up to six calls (the controller's tool loop), all
      // sharing a queue with every other project on this server. A single
      // short retry costs less than losing the caller's turn to one 429.
      retryOnBusy: true,
      payload: {
        model: config.AI_LLM_MODEL,
        messages: toWireMessages(fitted),
        tools: tools.length ? toWireTools(tools) : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false,
      },
    });

    const choice = response.choices?.[0];
    const message = choice?.message;

    const calls: LLMToolCall[] = (message?.tool_calls ?? [])
      .filter((tc) => typeof tc.function?.name === 'string' && tc.function.name.length > 0)
      .map((tc, index) => ({
        id: tc.id ?? `call_${index}`,
        name: tc.function!.name!,
        argumentsJson: tc.function?.arguments ?? '{}',
      }));

    const truncated = choice?.finish_reason === 'length';

    if (calls.length > 0) {
      // A reply cut off at the generation cap can end mid-JSON, or mid-function
      // NAME. The controller parses argumentsJson with a try/catch that falls
      // back to {}, so a truncated call would run as set_checkout_field({}) or
      // add_cart_items({}) — a silent wrong mutation on a real order rather
      // than a visible failure. A truncated tool call is never trustworthy,
      // even when its arguments happen to parse, so refuse the whole turn.
      if (truncated) {
        throw new PlymaxxRequestError(
          `${ADAPTER}: tool call "${calls[0]!.name}" was cut off by the ${maxTokens}-token generation cap — ` +
            'refusing rather than running a partially generated call.',
          'upstream',
          null,
        );
      }
      for (const call of calls) {
        if (!isUsableToolArguments(call.argumentsJson)) {
          throw new PlymaxxRequestError(
            `${ADAPTER}: tool call "${call.name}" returned unparseable arguments — ` +
              'refusing rather than running it with empty arguments.',
            'upstream',
            null,
          );
        }
      }
      return { kind: 'tool_calls', calls };
    }

    const content = message?.content ?? '';

    if (content.trim() === '') {
      // Returning an empty reply here is silence on a live call, and the
      // caller cannot tell it apart from a deliberate non-answer. Fail loudly
      // so the turn is retried or surfaced instead.
      throw new PlymaxxRequestError(
        `${ADAPTER}: model returned no text and no tool call` +
          `${truncated ? ` (cut off by the ${maxTokens}-token cap)` : ''}.`,
        'upstream',
        null,
      );
    }

    if (truncated) {
      // The server clamps generation at 256 tokens, so an over-long reply is
      // returned truncated rather than refused. Surfacing it keeps a clipped
      // spoken sentence from being mistaken for a model quality problem.
      // eslint-disable-next-line no-console
      console.warn(`[plymaxx-llm] reply hit the ${maxTokens}-token generation cap and may be cut short.`);
    }

    return { kind: 'message', content };
  }
}
