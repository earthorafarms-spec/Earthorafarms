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
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

export interface ToolModule {
  definition: ToolDefinition;
  handler: ToolHandler;
}
