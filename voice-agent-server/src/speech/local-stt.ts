import { STTProvider, SupportedLanguage, TranscribeResult } from "./types.js";

export class LocalSTT implements STTProvider {
  private localSttUrl: string;

  constructor() {
    this.localSttUrl = (process.env.LOCAL_STT_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
  }

  async transcribe(audioBuffer: Buffer, language?: SupportedLanguage): Promise<TranscribeResult> {
    const audioBase64 = audioBuffer.toString("base64");
    const payload = {
      audio_base64: audioBase64,
      language: language || null,
    };

    const res = await fetch(`${this.localSttUrl}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Local faster-whisper STT failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const text = data.text || "";
    const detectedLang = data.detectedLang || language || "en";

    return { text, detectedLang };
  }
}
