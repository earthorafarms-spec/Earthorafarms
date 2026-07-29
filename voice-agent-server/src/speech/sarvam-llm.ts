import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, Message, Tool, LLMResponse, SarvamRateLimitError } from "./types.js";

export class SarvamOrAnthropicLLM implements LLMProvider {
  private anthropic: Anthropic | null = null;
  private sarvamApiKey: string;
  private useSarvamLLM: boolean;

  constructor() {
    this.sarvamApiKey = process.env.SARVAM_API_KEY || "";
    this.useSarvamLLM = process.env.SARVAM_USE_LLM === "true";

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      this.anthropic = new Anthropic({ apiKey: anthropicKey });
    }
  }

  async chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    if (this.useSarvamLLM) {
      return this.chatSarvamGateway(messages, tools);
    }
    return this.chatAnthropic(messages, tools);
  }

  private async chatAnthropic(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    if (!this.anthropic) {
      throw new Error("ANTHROPIC_API_KEY is not configured for Claude model");
    }

    const systemMsg = messages.find((m) => m.role === "system")?.content;
    const conversation = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const formattedTools = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

    const res = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: systemMsg,
      messages: conversation,
      tools: formattedTools,
    });

    let textResponse = "";
    const toolCalls: any[] = [];

    for (const block of res.content) {
      if (block.type === "text") {
        textResponse += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, any>,
        });
      }
    }

    return {
      text: textResponse,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private async chatSarvamGateway(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    if (!this.sarvamApiKey) {
      throw new SarvamRateLimitError("SARVAM_API_KEY is not configured", 401);
    }

    try {
      const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": this.sarvamApiKey,
        },
        body: JSON.stringify({
          model: "sarvam-2b",
          messages,
          tools,
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        throw new SarvamRateLimitError(`Sarvam LLM HTTP Error ${res.status}`, res.status);
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Sarvam LLM failed status ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const choice = data.choices && data.choices[0];
      const text = choice?.message?.content || "";
      const toolCalls = choice?.message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        input: typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function?.arguments,
      }));

      return { text, toolCalls };
    } catch (err: any) {
      if (err instanceof SarvamRateLimitError) throw err;
      throw new SarvamRateLimitError(`Sarvam LLM network error: ${err.message}`, 503);
    }
  }
}
