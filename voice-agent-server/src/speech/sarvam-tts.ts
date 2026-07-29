import { TTSProvider, SupportedLanguage, SarvamRateLimitError } from "./types.js";

export class SarvamTTS implements TTSProvider {
  private apiKey: string;
  private baseUrl: string = "https://api.sarvam.ai";

  constructor() {
    this.apiKey = process.env.SARVAM_API_KEY || "";
  }

  async synthesize(text: string, language: SupportedLanguage): Promise<Buffer> {
    if (!this.apiKey) {
      throw new SarvamRateLimitError("SARVAM_API_KEY is not configured", 401);
    }

    try {
      const targetLangCode = language === "hi" ? "hi-IN" : language === "gu" ? "gu-IN" : "en-IN";
      const bodyPayload = {
        inputs: [text],
        target_language_code: targetLangCode,
        speaker: "meera",
        pitch: 0,
        pace: 1.05,
        loudness: 1.5,
        speech_sample_rate: 8000, // Matching SmartFlo telephony 8kHz μ-law / PCM
        enable_preprocessing: true,
        model: "bulbul:v1",
      };

      const res = await fetch(`${this.baseUrl}/text-to-speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": this.apiKey,
        },
        body: JSON.stringify(bodyPayload),
      });

      if (res.status === 429 || res.status >= 500) {
        throw new SarvamRateLimitError(`Sarvam TTS HTTP Error ${res.status}: ${res.statusText}`, res.status);
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Sarvam TTS failed with status ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const base64Audio = data.audios && data.audios[0];
      if (!base64Audio) {
        throw new Error("Sarvam TTS returned no audio data in response");
      }

      return Buffer.from(base64Audio, "base64");
    } catch (err: any) {
      if (err instanceof SarvamRateLimitError) throw err;
      if (err.name === "FetchError" || err.message?.includes("fetch") || err.message?.includes("connect")) {
        throw new SarvamRateLimitError(`Sarvam TTS network error: ${err.message}`, 503);
      }
      throw err;
    }
  }
}
