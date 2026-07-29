import { STTProvider, SupportedLanguage, TranscribeResult, SarvamRateLimitError } from "./types.js";

export class SarvamSTT implements STTProvider {
  private apiKey: string;
  private baseUrl: string = "https://api.sarvam.ai";

  constructor() {
    this.apiKey = process.env.SARVAM_API_KEY || "";
  }

  async transcribe(audioBuffer: Buffer, language?: SupportedLanguage): Promise<TranscribeResult> {
    if (!this.apiKey) {
      throw new SarvamRateLimitError("SARVAM_API_KEY is not configured", 401);
    }

    try {
      const formData = new FormData();
      const arrayBuffer = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: "audio/wav" });
      formData.append("file", blob, "audio.wav");
      formData.append("model", "saarika");
      if (language) {
        formData.append("language_code", language === "hi" ? "hi-IN" : language === "gu" ? "gu-IN" : "en-IN");
      }

      const res = await fetch(`${this.baseUrl}/speech-to-text`, {
        method: "POST",
        headers: {
          "api-subscription-key": this.apiKey,
        },
        body: formData,
      });

      if (res.status === 429 || res.status >= 500) {
        throw new SarvamRateLimitError(`Sarvam STT HTTP Error ${res.status}: ${res.statusText}`, res.status);
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Sarvam STT failed with status ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const text = data.transcript || data.text || "";
      const langCode = data.language_code || language || "en";
      const detectedLang = langCode.startsWith("hi") ? "hi" : langCode.startsWith("gu") ? "gu" : "en";

      return { text, detectedLang };
    } catch (err: any) {
      if (err instanceof SarvamRateLimitError) throw err;
      if (err.name === "FetchError" || err.message?.includes("fetch") || err.message?.includes("connect")) {
        throw new SarvamRateLimitError(`Sarvam STT network error: ${err.message}`, 503);
      }
      throw err;
    }
  }
}
