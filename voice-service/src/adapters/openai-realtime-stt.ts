import WebSocket, { type ClientOptions, type RawData } from 'ws';
import { config } from '../config.js';
import type { SupportedLanguage } from '../conversation/language.js';
import type { TranscriptionResult } from './types.js';

type SessionState = 'connecting' | 'ready' | 'failed' | 'closed';

interface PendingTurn {
  settled: boolean;
  itemId?: string;
  resolve: (result: TranscriptionResult | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type RealtimeSttStatusHandler = (state: SessionState, detail?: string) => void;
export type RealtimeSocketFactory = (url: string, options: ClientOptions) => WebSocket;

const BASE_KEYWORDS = [
  'Earthora Farms', 'Morilife+', 'Moringa Leaf Tablets', 'GST',
  'phone number', 'PIN code', 'Ahmedabad', 'Gujarat',
];

/**
 * One live OpenAI transcription socket per telephone call.
 *
 * Smartflo already sends native 8 kHz G.711 mu-law, which the Realtime API
 * accepts directly. Audio is therefore recognized while the caller speaks;
 * the existing local endpoint detector still decides when to commit a turn.
 * If the socket is unavailable, commit() returns null and the route falls
 * back to the proven WAV/file transcription path for that turn.
 */
export class OpenAiRealtimeSttSession {
  private socket: WebSocket;
  private state: SessionState = 'connecting';
  private audioBuffered = false;
  private readonly awaitingCommitAck: PendingTurn[] = [];
  private readonly pendingByItem = new Map<string, PendingTurn>();
  private language: SupportedLanguage | undefined;
  private expectedInput: 'phone' | 'postalCode' | 'quantity' | undefined;

  constructor(
    private readonly onStatus?: RealtimeSttStatusHandler,
    socketFactory: RealtimeSocketFactory = (url, options) => new WebSocket(url, options),
  ) {
    // The intent query creates a dedicated transcription session; the model
    // itself is selected inside session.update below.
    const url = 'wss://api.openai.com/v1/realtime?intent=transcription';
    this.socket = socketFactory(url, {
      headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}` },
      handshakeTimeout: config.VOICE_STT_TIMEOUT_MS,
    });
    this.socket.on('open', () => this.sendSessionUpdate());
    this.socket.on('message', (raw) => this.handleMessage(raw));
    this.socket.on('error', (error) => this.fail(error.message));
    this.socket.on('close', () => {
      if (this.state !== 'closed') this.fail('realtime transcription socket closed');
    });
  }

  appendMulaw8k(audio: Buffer): boolean {
    if (this.state !== 'ready' || audio.length === 0 || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audio.toString('base64') }));
    this.audioBuffered = true;
    return true;
  }

  commit(): Promise<TranscriptionResult | null> {
    if (this.state !== 'ready' || !this.audioBuffered || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve(null);
    }
    this.audioBuffered = false;
    return new Promise((resolve) => {
      const pending = {} as PendingTurn;
      pending.settled = false;
      pending.resolve = resolve;
      pending.timer = setTimeout(() => this.settle(pending, null), config.VOICE_STT_TIMEOUT_MS);
      this.awaitingCommitAck.push(pending);
      this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    });
  }

  updateContext(
    language: SupportedLanguage,
    languageEstablished: boolean,
    expectedInput?: 'phone' | 'postalCode' | 'quantity',
  ): void {
    this.language = languageEstablished ? language : undefined;
    this.expectedInput = expectedInput;
    if (this.state === 'ready') this.sendSessionUpdate();
  }

  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.resolveAll(null);
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(1000, 'telephone call ended');
    }
  }

  private sendSessionUpdate(): void {
    if (this.socket.readyState !== WebSocket.OPEN || this.state === 'failed' || this.state === 'closed') return;
    const numericPrompt = this.expectedInput
      ? ` The next reply may be a ${this.expectedInput === 'postalCode' ? 'six digit Indian PIN code' : this.expectedInput === 'phone' ? 'ten digit Indian mobile number' : 'product quantity'}; preserve every spoken digit exactly.`
      : '';
    this.socket.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            transcription: {
              model: config.OPENAI_REALTIME_STT_MODEL,
              prompt: `An Earthora Farms ordering call. Transcribe only audible speech without translation.${numericPrompt}`,
              keywords: BASE_KEYWORDS,
              ...(this.language ? { languages: [this.language] } : { languages: ['en', 'hi', 'gu'] }),
              delay: 'low',
            },
            turn_detection: null,
            noise_reduction: { type: 'near_field' },
          },
        },
      },
    }));
  }

  private handleMessage(raw: RawData): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event.type === 'session.updated') {
      if (this.state === 'connecting') {
        this.state = 'ready';
        this.onStatus?.('ready');
      }
      return;
    }
    if (event.type === 'input_audio_buffer.committed' && typeof event.item_id === 'string') {
      let pending = this.awaitingCommitAck.shift();
      while (pending?.settled) pending = this.awaitingCommitAck.shift();
      if (pending) {
        pending.itemId = event.item_id;
        this.pendingByItem.set(event.item_id, pending);
      }
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed' &&
        typeof event.item_id === 'string' && typeof event.transcript === 'string') {
      const pending = this.pendingByItem.get(event.item_id);
      if (pending) this.settle(pending, { text: event.transcript });
      return;
    }
    if (event.type === 'error') {
      const nested = event.error as { message?: unknown } | undefined;
      this.fail(typeof nested?.message === 'string' ? nested.message : 'OpenAI realtime transcription error');
    }
  }

  private settle(pending: PendingTurn, result: TranscriptionResult | null): void {
    if (pending.settled) return;
    pending.settled = true;
    clearTimeout(pending.timer);
    if (pending.itemId) this.pendingByItem.delete(pending.itemId);
    pending.resolve(result);
  }

  private resolveAll(result: TranscriptionResult | null): void {
    for (const pending of this.awaitingCommitAck) this.settle(pending, result);
    for (const pending of this.pendingByItem.values()) this.settle(pending, result);
    this.awaitingCommitAck.length = 0;
    this.pendingByItem.clear();
  }

  private fail(detail: string): void {
    if (this.state === 'failed' || this.state === 'closed') return;
    this.state = 'failed';
    this.resolveAll(null);
    this.onStatus?.('failed', detail);
  }
}
