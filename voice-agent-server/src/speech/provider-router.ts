import { STTProvider, TTSProvider, LLMProvider, SarvamRateLimitError } from "./types.js";
import { SarvamSTT } from "./sarvam-stt.js";
import { SarvamTTS } from "./sarvam-tts.js";
import { SarvamOrAnthropicLLM } from "./sarvam-llm.js";
import { LocalSTT } from "./local-stt.js";
import { LocalTTS } from "./local-tts.js";
import { LocalLLM } from "./local-llm.js";

type ProviderMode = 'sarvam' | 'local';
type LLMMode = 'anthropic' | 'local-ollama';

class ProviderRouter {
  private sarvamSTT = new SarvamSTT();
  private sarvamTTS = new SarvamTTS();
  private sarvamOrAnthropicLLM = new SarvamOrAnthropicLLM();

  private localSTT = new LocalSTT();
  private localTTS = new LocalTTS();
  private localLLM = new LocalLLM();

  private isSarvamDegraded = false;
  private degradedSince: Date | null = null;
  private checkIntervalMs = 60 * 1000; // 60 seconds

  constructor() {
    this.startHealthCheckLoop();
  }

  public getSpeechProvider(): { stt: STTProvider; tts: TTSProvider; mode: ProviderMode } {
    if (this.isSarvamDegraded) {
      return { stt: this.localSTT, tts: this.localTTS, mode: 'local' };
    }
    return {
      stt: this.createWrappedSTT(this.sarvamSTT, this.localSTT),
      tts: this.createWrappedTTS(this.sarvamTTS, this.localTTS),
      mode: 'sarvam',
    };
  }

  public getLLMProvider(): { llm: LLMProvider; mode: LLMMode } {
    if (this.isSarvamDegraded) {
      return { llm: this.localLLM, mode: 'local-ollama' };
    }
    return {
      llm: this.createWrappedLLM(this.sarvamOrAnthropicLLM, this.localLLM),
      mode: 'anthropic',
    };
  }

  public getProviderStatus() {
    return {
      speechProvider: this.isSarvamDegraded ? 'local' : 'sarvam',
      llmProvider: this.isSarvamDegraded ? 'local-ollama' : 'anthropic',
      isSarvamDegraded: this.isSarvamDegraded,
      degradedSince: this.degradedSince?.toISOString() || null,
      healthCheckIntervalSeconds: 60,
    };
  }

  private markDegraded(reason: string) {
    if (!this.isSarvamDegraded) {
      this.isSarvamDegraded = true;
      this.degradedSince = new Date();
      console.warn(`⚠️ [ProviderRouter] Sarvam AI marked DEGRADED due to: ${reason}. Switching speech & LLM traffic to local fallback for 60s.`);
    }
  }

  private markRecovered() {
    if (this.isSarvamDegraded) {
      this.isSarvamDegraded = false;
      this.degradedSince = null;
      console.log(`✅ [ProviderRouter] Sarvam AI has RECOVERED. Switching speech & LLM traffic back to Sarvam primary.`);
    }
  }

  private createWrappedSTT(primary: STTProvider, fallback: STTProvider): STTProvider {
    return {
      transcribe: async (buffer, lang) => {
        try {
          return await primary.transcribe(buffer, lang);
        } catch (err: any) {
          if (err instanceof SarvamRateLimitError) {
            this.markDegraded(err.message);
            console.warn(`[STT Fallback] Retrying transcription on LocalSTT...`);
            return await fallback.transcribe(buffer, lang);
          }
          throw err;
        }
      },
    };
  }

  private createWrappedTTS(primary: TTSProvider, fallback: TTSProvider): TTSProvider {
    return {
      synthesize: async (text, lang) => {
        try {
          return await primary.synthesize(text, lang);
        } catch (err: any) {
          if (err instanceof SarvamRateLimitError) {
            this.markDegraded(err.message);
            console.warn(`[TTS Fallback] Retrying synthesis on LocalTTS...`);
            return await fallback.synthesize(text, lang);
          }
          throw err;
        }
      },
    };
  }

  private createWrappedLLM(primary: LLMProvider, fallback: LLMProvider): LLMProvider {
    return {
      chat: async (messages, tools) => {
        try {
          return await primary.chat(messages, tools);
        } catch (err: any) {
          if (err instanceof SarvamRateLimitError) {
            this.markDegraded(err.message);
            console.warn(`[LLM Fallback] Retrying chat completion on LocalLLM (Ollama)...`);
            return await fallback.chat(messages, tools);
          }
          throw err;
        }
      },
    };
  }

  private startHealthCheckLoop() {
    setInterval(async () => {
      if (!this.isSarvamDegraded) return;

      const apiKey = process.env.SARVAM_API_KEY;
      if (!apiKey) return;

      try {
        // Ping Sarvam API to check recovery
        const res = await fetch("https://api.sarvam.ai/speech-to-text", {
          method: "OPTIONS",
          headers: { "api-subscription-key": apiKey },
        });

        if (res.status !== 429 && res.status < 500) {
          this.markRecovered();
        }
      } catch (err) {
        // Still unreachable/degraded
      }
    }, this.checkIntervalMs);
  }
}

export const providerRouter = new ProviderRouter();
