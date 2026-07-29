import { SupportedLanguage } from "./types.js";
import { providerRouter } from "./provider-router.js";

export const GREETINGS = {
  multilingual: "Welcome to Earthora Farms. Please speak in English, Hindi, or Gujarati. Earthora Farms mein aapka swagat hai. Hindi, English, ya Gujarati mein boliye. Earthora Farms maa aapnu swagat chhe. Gujarati, Hindi, ke English maa boliye.",
  en: "Welcome to Earthora Farms. How can I help you today?",
  hi: "Earthora Farms mein aapka swagat hai. Main aapki kya sahayata kar sakti hoon?",
  gu: "Earthora Farms maa aapnu swagat chhe. Hu aapni su madad kari shaku?",
};

export class LanguageSelector {
  public getInitialGreetingText(): string {
    return GREETINGS.multilingual;
  }

  public async generateInitialGreetingAudio(): Promise<Buffer> {
    const { tts } = providerRouter.getSpeechProvider();
    return await tts.synthesize(GREETINGS.en, "en");
  }

  public async detectOrConfirmLanguage(
    audioBuffer: Buffer,
    hint?: SupportedLanguage
  ): Promise<{ selectedLanguage: SupportedLanguage; initialTranscript: string }> {
    const { stt } = providerRouter.getSpeechProvider();
    const result = await stt.transcribe(audioBuffer, hint);
    const text = result.text.toLowerCase();

    let selectedLanguage: SupportedLanguage = "en";

    if (result.detectedLang === "hi" || result.detectedLang === "gu") {
      selectedLanguage = result.detectedLang as SupportedLanguage;
    } else if (text.includes("hindi") || text.includes("namaste") || text.includes("haan") || text.includes("chahiye")) {
      selectedLanguage = "hi";
    } else if (text.includes("gujarati") || text.includes("kem cho") || text.includes("majama") || text.includes("joie")) {
      selectedLanguage = "gu";
    } else {
      selectedLanguage = "en";
    }

    return {
      selectedLanguage,
      initialTranscript: result.text,
    };
  }
}

export const languageSelector = new LanguageSelector();
