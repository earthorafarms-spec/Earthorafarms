import { Message, SupportedLanguage } from "../speech/types.js";
import { providerRouter } from "../speech/provider-router.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { agentTools, executeToolCall, supabase } from "./tools.js";
import { smartFloAdapter } from "../telephony/smartflo-adapter.js";

export interface CallSessionState {
  callId: string;
  callerPhone: string;
  language: SupportedLanguage;
  messages: Message[];
  startedAt: string;
  orderId?: string;
  matchedEmail?: string;
}

class AgentOrchestrator {
  private activeSessions = new Map<string, CallSessionState>();

  public async startSession(callId: string, callerPhone: string, language: SupportedLanguage): Promise<void> {
    const systemPrompt = buildSystemPrompt(language);
    const sessionState: CallSessionState = {
      callId,
      callerPhone,
      language,
      messages: [{ role: "system", content: systemPrompt }],
      startedAt: new Date().toISOString(),
    };

    // Lookup customer email if available
    const cleanPhone = callerPhone.replace(/[\s-]/g, "");
    const { data: user } = await supabase
      .from("User_details")
      .select("user_email")
      .eq("user_phone", cleanPhone)
      .maybeSingle();

    if (user) {
      sessionState.matchedEmail = user.user_email;
    }

    this.activeSessions.set(callId, sessionState);

    // Create session record in Supabase
    try {
      await supabase.from("call_sessions").insert({
        caller_phone: callerPhone,
        language,
        started_at: sessionState.startedAt,
        matched_user_email: sessionState.matchedEmail || null,
        transcript: [],
      });
    } catch (err: any) {
      console.error(`⚠️ [Orchestrator] Error initializing DB call_sessions row:`, err.message);
    }
  }

  public async processUserUtterance(callId: string, userText: string): Promise<void> {
    const session = this.activeSessions.get(callId);
    if (!session) {
      console.warn(`[Orchestrator] Session not found for call ${callId}`);
      return;
    }

    try {
      // 1. Append user utterance to memory & DB transcript
      session.messages.push({ role: "user", content: userText });
      await this.appendTranscriptToDB(callId, "user", userText);

      // 2. Query LLM provider with tools
      const { llm } = providerRouter.getLLMProvider();
      let response = await llm.chat(session.messages, agentTools);

      // 3. Handle Tool Calls loop (up to 3 sequential tool executions)
      let toolAttempts = 0;
      while (response.toolCalls && response.toolCalls.length > 0 && toolAttempts < 3) {
        toolAttempts++;
        for (const toolCall of response.toolCalls) {
          console.log(`🛠️ [Tool Executing] Call ${callId} -> ${toolCall.name}:`, toolCall.input);
          const toolResult = await executeToolCall(toolCall.name, toolCall.input);

          // Track order ID if created
          if (toolCall.name === "create_order" && toolResult.success && toolResult.orderId) {
            session.orderId = toolResult.orderId;
          }

          // Append tool response to message history
          session.messages.push({
            role: "assistant",
            content: `[Tool Output - ${toolCall.name}]: ${JSON.stringify(toolResult)}`,
          });
        }

        // Re-query LLM with tool outputs
        response = await llm.chat(session.messages, agentTools);
      }

      // 4. Get final assistant spoken text
      const assistantText = response.text.trim();
      if (assistantText) {
        session.messages.push({ role: "assistant", content: assistantText });
        await this.appendTranscriptToDB(callId, "assistant", assistantText);

        // 5. Synthesize speech and send to caller
        const { tts } = providerRouter.getSpeechProvider();
        const audioBuffer = await tts.synthesize(assistantText, session.language);
        smartFloAdapter.sendAudio(callId, audioBuffer);
      }
    } catch (err: any) {
      console.error(`❌ [Orchestrator Error]:`, err);
      // Apologize gracefully without dropping the call
      try {
        const apology = session.language === "hi"
          ? "Kshama kijiye, ek takneeki samasya aayi hai. Kripya punah prayas karein."
          : session.language === "gu"
          ? "Kshama karsho, ek takneeki samasya aavi chhe. Kripya fari prayatna karo."
          : "I apologize, an unexpected technical error occurred. Please try again.";

        const { tts } = providerRouter.getSpeechProvider();
        const errorAudio = await tts.synthesize(apology, session.language);
        smartFloAdapter.sendAudio(callId, errorAudio);
      } catch (ttsErr: any) {
        console.error("❌ Failed to synthesize error apology:", ttsErr);
      }
    }
  }

  public async endSession(callId: string, reason?: string): Promise<void> {
    const session = this.activeSessions.get(callId);
    if (!session) return;

    const endedAt = new Date().toISOString();
    let outcome = "faq_answered";

    // Infer session outcome from transcript history
    const transcriptText = session.messages.map((m) => m.content).join(" ");
    if (session.orderId) {
      outcome = "order_placed";
    } else if (transcriptText.includes("cancel_order")) {
      outcome = "order_cancelled";
    } else if (transcriptText.includes("modify_order")) {
      outcome = "order_modified";
    } else if (transcriptText.includes("get_order_status")) {
      outcome = "status_checked";
    } else if (session.messages.length <= 2) {
      outcome = "abandoned";
    }

    try {
      await supabase
        .from("call_sessions")
        .update({
          ended_at: endedAt,
          outcome,
          order_id: session.orderId || null,
        })
        .eq("caller_phone", session.callerPhone);
    } catch (err: any) {
      console.error(`⚠️ [Orchestrator] Error updating final call_session:`, err.message);
    } finally {
      this.activeSessions.delete(callId);
    }
  }

  private async appendTranscriptToDB(callId: string, role: "user" | "assistant", text: string) {
    const session = this.activeSessions.get(callId);
    if (!session) return;

    try {
      const entry = { role, text, timestamp: new Date().toISOString() };
      const { data: current } = await supabase
        .from("call_sessions")
        .select("transcript")
        .eq("caller_phone", session.callerPhone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const existingArray = current?.transcript && Array.isArray(current.transcript) ? current.transcript : [];
      const updatedArray = [...existingArray, entry];

      await supabase
        .from("call_sessions")
        .update({ transcript: updatedArray })
        .eq("caller_phone", session.callerPhone);
    } catch (err: any) {
      console.error(`⚠️ [Orchestrator] Error pushing transcript:`, err.message);
    }
  }
}

export const agentOrchestrator = new AgentOrchestrator();
