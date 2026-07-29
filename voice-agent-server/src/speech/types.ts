export type SupportedLanguage = 'en' | 'hi' | 'gu';

export interface TranscribeResult {
  text: string;
  detectedLang: SupportedLanguage | string;
}

export interface STTProvider {
  transcribe(audioBuffer: Buffer, language?: SupportedLanguage): Promise<TranscribeResult>;
}

export interface TTSProvider {
  synthesize(text: string, language: SupportedLanguage): Promise<Buffer>;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolProperty | Record<string, any>;
  properties?: Record<string, ToolProperty>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, ToolProperty>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface LLMResponse {
  text: string;
  toolCalls?: ToolCall[];
}

export interface LLMProvider {
  chat(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
}

export class SarvamRateLimitError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "SarvamRateLimitError";
  }
}
