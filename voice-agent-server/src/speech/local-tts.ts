import { TTSProvider, SupportedLanguage } from "./types.js";

export class LocalTTS implements TTSProvider {
  private localTtsUrl: string;

  constructor() {
    this.localTtsUrl = (process.env.LOCAL_TTS_URL || "http://127.0.0.1:8002").replace(/\/$/, "");
  }

  async synthesize(text: string, language: SupportedLanguage): Promise<Buffer> {
    const payload = { text, language };

    const res = await fetch(`${this.localTtsUrl}/synthesize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Local Piper TTS failed (${res.status}): ${errText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
