import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { describe, expect, it } from 'vitest';
import type { RealtimeSocketFactory } from '../../src/adapters/openai-realtime-stt.js';
import { OpenAiRealtimeSttSession } from '../../src/adapters/openai-realtime-stt.js';

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  sent: Record<string, any>[] = [];

  send(value: string): void {
    this.sent.push(JSON.parse(value));
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit('open');
  }

  serverMessage(event: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(event)));
  }
}

describe('OpenAI realtime transcription session', () => {
  it('streams native mu-law and resolves the committed item transcript', async () => {
    const socket = new FakeSocket();
    const statuses: string[] = [];
    const session = new OpenAiRealtimeSttSession(
      (state) => statuses.push(state),
      (() => socket as unknown as WebSocket) as RealtimeSocketFactory,
    );

    expect(session.appendMulaw8k(Buffer.from([0xff]))).toBe(false);
    socket.open();
    expect(socket.sent[0]).toMatchObject({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: { input: { format: { type: 'audio/pcmu' }, turn_detection: null } },
      },
    });
    socket.serverMessage({ type: 'session.updated' });
    expect(statuses).toEqual(['ready']);

    expect(session.appendMulaw8k(Buffer.from([0xff, 0x7f]))).toBe(true);
    const transcriptPromise = session.commit();
    expect(socket.sent.at(-2)).toEqual({
      type: 'input_audio_buffer.append', audio: Buffer.from([0xff, 0x7f]).toString('base64'),
    });
    expect(socket.sent.at(-1)).toEqual({ type: 'input_audio_buffer.commit' });

    socket.serverMessage({ type: 'input_audio_buffer.committed', item_id: 'item-1' });
    socket.serverMessage({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item-1',
      transcript: 'I would like two bottles.',
    });
    await expect(transcriptPromise).resolves.toEqual({ text: 'I would like two bottles.' });
    session.close();
  });

  it('falls back cleanly when the realtime service reports an error', async () => {
    const socket = new FakeSocket();
    const statuses: string[] = [];
    const session = new OpenAiRealtimeSttSession(
      (state) => statuses.push(state),
      (() => socket as unknown as WebSocket) as RealtimeSocketFactory,
    );
    socket.open();
    socket.serverMessage({ type: 'session.updated' });
    session.appendMulaw8k(Buffer.alloc(160, 0xff));
    const pending = session.commit();

    socket.serverMessage({ type: 'error', error: { message: 'model unavailable' } });

    await expect(pending).resolves.toBeNull();
    expect(statuses).toEqual(['ready', 'failed']);
    expect(session.appendMulaw8k(Buffer.alloc(160, 0xff))).toBe(false);
  });
});
