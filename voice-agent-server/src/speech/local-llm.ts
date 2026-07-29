import { LLMProvider, Message, Tool, LLMResponse } from "./types.js";

export class LocalLLM implements LLMProvider {
  private localLlmUrl: string;
  private model: string;

  constructor() {
    this.localLlmUrl = (process.env.LOCAL_LLM_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
    this.model = process.env.LOCAL_LLM_MODEL || "qwen2.5:7b";
  }

  async chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    const formattedMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const formattedTools = tools?.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const payload: any = {
      model: this.model,
      messages: formattedMessages,
      stream: false,
    };

    if (formattedTools && formattedTools.length > 0) {
      payload.tools = formattedTools;
    }

    const res = await fetch(`${this.localLlmUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Local Ollama LLM failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const message = data.message || {};
    const text = message.content || "";

    let toolCalls: any[] = undefined as any;
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      toolCalls = message.tool_calls.map((tc: any, index: number) => ({
        id: tc.id || `call_ollama_${index}`,
        name: tc.function?.name,
        input: typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function?.arguments,
      }));
    }

    return { text, toolCalls };
  }
}
