import type { SarvamAI } from 'sarvamai';
import { requireSarvamKeys, withSarvamClient } from './sarvam-client.js';
import { config } from '../config.js';
import type { ToolDefinition } from '../tools/types.js';
import type { ConversationMessage } from '../conversation/state.js';
import type { LLMAdapter, LLMTurnResult } from './types.js';

// Sarvam's Chat Completions API (client.chat.completions) mirrors OpenAI's
// schema closely — same messages/tools/tool_calls shape, verified against
// the installed `sarvamai` SDK's type definitions before writing this
// (not guessed — see the two providers' near-identical request/response
// interfaces). The one notable gap: Sarvam's FunctionDefinition has no
// `strict` field, so it doesn't get OpenAI's strict-schema validation —
// harmless here since our tool schemas already satisfy the stricter rules
// anyway (every property in `required`, nullable unions for "optional").
function toSarvamMessages(messages: ConversationMessage[]): SarvamAI.ChatCompletionRequestMessage[] {
  return messages.map((m): SarvamAI.ChatCompletionRequestMessage => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.toolCallId! };
    }
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content || undefined,
        tool_calls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.argumentsJson },
        })),
      };
    }
    if (m.role === 'system') {
      return { role: 'system', content: m.content };
    }
    return { role: 'user', content: m.content };
  });
}

function toSarvamTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export class SarvamLLMAdapter implements LLMAdapter {
  constructor() {
    requireSarvamKeys();
  }

  async chatWithTools(messages: ConversationMessage[], tools: ToolDefinition[]): Promise<LLMTurnResult> {
    const completion = await withSarvamClient((client, requestOptions) => client.chat.completions({
      model: config.SARVAM_MODEL as SarvamAI.SarvamModelIds,
      stream: false,
      temperature: 0.2,
      // Keep low — Sarvam is now only used for TTS (LLM_PROVIDER=openai handles
      // all languages; OpenAI GPT-4o-mini reliably calls tools without needing
      // high reasoning effort, and is 5-8× faster than sarvam-105b at medium).
      // If LLM_PROVIDER is ever switched back to sarvam/auto, revisit this.
      reasoning_effort: 'low',
      messages: toSarvamMessages(messages),
      tools: toSarvamTools(tools),
      tool_choice: 'auto',
    }, requestOptions), config.VOICE_LLM_TIMEOUT_MS);

    const choice = completion.choices[0];
    const message = choice?.message;

    if (message?.tool_calls && message.tool_calls.length > 0) {
      return {
        kind: 'tool_calls',
        calls: message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          argumentsJson: tc.function.arguments,
        })),
      };
    }

    return { kind: 'message', content: message?.content ?? '' };
  }
}
