import OpenAI from 'openai';
import { config } from '../config.js';
import type { ToolDefinition } from '../tools/types.js';
import type { ConversationMessage } from '../conversation/state.js';
import type { LLMAdapter, LLMTurnResult } from './types.js';

function toOpenAiMessages(messages: ConversationMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId!,
        content: m.content,
      } satisfies OpenAI.Chat.ChatCompletionToolMessageParam;
    }
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.argumentsJson },
        })),
      } satisfies OpenAI.Chat.ChatCompletionAssistantMessageParam;
    }
    return { role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam;
  });
}

function toOpenAiTools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      strict: true,
    },
  }));
}

/** Low temperature, strict tool schemas, per 04-AGENT-SPEC.md section 1. */
export class OpenAiLLMAdapter implements LLMAdapter {
  private client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  async chatWithTools(messages: ConversationMessage[], tools: ToolDefinition[]): Promise<LLMTurnResult> {
    const completion = await this.client.chat.completions.create({
      model: config.OPENAI_MODEL,
      temperature: 0.2,
      messages: toOpenAiMessages(messages),
      tools: toOpenAiTools(tools),
      tool_choice: 'auto',
    });

    const choice = completion.choices[0];
    const message = choice?.message;

    if (message?.tool_calls && message.tool_calls.length > 0) {
      return {
        kind: 'tool_calls',
        calls: message.tool_calls
          .filter((tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: 'function' } => tc.type === 'function')
          .map((tc) => ({ id: tc.id, name: tc.function.name, argumentsJson: tc.function.arguments })),
      };
    }

    return { kind: 'message', content: message?.content ?? '' };
  }
}
