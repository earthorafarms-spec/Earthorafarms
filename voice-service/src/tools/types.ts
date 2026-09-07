import type { ConversationState } from '../conversation/state.js';

export interface ToolDefinition {
  name: string;
  description: string;
  /** Strict JSON Schema — OpenAI is configured with strict:true, so this must be exact. */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export interface ToolContext {
  callSessionId: string;
  state: ConversationState;
  /** Transport that initiated this turn. Omitted by older/direct callers and treated as voice. */
  channel?: 'voice' | 'text';
  /** Turn-local transport actions. They are deliberately not exposed in the tool result sent to the LLM. */
  outboundActions?: OutboundAction[];
}

export type OutboundAction =
  | { type: 'checkout_review'; url: string };

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

export interface ToolModule {
  definition: ToolDefinition;
  handler: ToolHandler;
}
