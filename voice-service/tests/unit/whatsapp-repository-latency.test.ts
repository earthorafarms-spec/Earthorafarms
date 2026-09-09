import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('../../src/lib/supabaseClient.js', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { claimNextWhatsAppMessage } from '../../../whatsapp-chatbot/events.repository.js';
import { getOrCreateSession } from '../../../whatsapp-chatbot/sessions.repository.js';

describe('whatsapp repositories latency optimizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('claimNextWhatsAppMessage', () => {
    it('returns null when no event is claimed', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await claimNextWhatsAppMessage();
      expect(result).toBeNull();
      expect(mockRpc).toHaveBeenCalledWith('claim_next_whatsapp_message');
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('fast path: uses media fields directly when returned by RPC without second query', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          id: 'evt-1',
          provider_message_id: 'msg-1',
          phone_number: '+919876543210',
          message_text: 'Hi',
          reply_text: 'Hello!',
          attempt_count: 1,
          outbound_media_url: 'https://example.com/image.png',
          outbound_media_caption: 'Caption',
          media_sent_at: '2026-09-09T10:00:00Z',
        },
        error: null,
      });

      const result = await claimNextWhatsAppMessage();
      expect(result).toEqual({
        id: 'evt-1',
        providerMessageId: 'msg-1',
        phone: '+919876543210',
        messageText: 'Hi',
        replyText: 'Hello!',
        mediaUrl: 'https://example.com/image.png',
        mediaCaption: 'Caption',
        mediaSentAt: '2026-09-09T10:00:00Z',
        attemptCount: 1,
      });
      // Verification: NO second query was made to supabase.from()!
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('fallback path: performs secondary select when running against older RPC missing media columns', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          id: 'evt-old',
          provider_message_id: 'msg-old',
          phone_number: '+919876543210',
          message_text: 'Hi',
          reply_text: null,
          attempt_count: 1,
          // outbound_media_url is undefined here
        },
        error: null,
      });

      const mockSingle = vi.fn().mockResolvedValueOnce({
        data: {
          outbound_media_url: 'https://example.com/fallback.png',
          outbound_media_caption: 'Fallback caption',
          media_sent_at: null,
        },
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      mockFrom.mockReturnValue({ select: mockSelect });

      const result = await claimNextWhatsAppMessage();
      expect(result).toEqual({
        id: 'evt-old',
        providerMessageId: 'msg-old',
        phone: '+919876543210',
        messageText: 'Hi',
        replyText: null,
        mediaUrl: 'https://example.com/fallback.png',
        mediaCaption: 'Fallback caption',
        mediaSentAt: null,
        attemptCount: 1,
      });
      expect(mockFrom).toHaveBeenCalledWith('whatsapp_message_events');
      expect(mockSelect).toHaveBeenCalledWith('outbound_media_url, outbound_media_caption, media_sent_at');
      expect(mockEq).toHaveBeenCalledWith('id', 'evt-old');
    });
  });

  describe('getOrCreateSession', () => {
    it('fast path: returns active session in a single consolidated query', async () => {
      const futureDate = new Date(Date.now() + 3600_000).toISOString();
      const mockMaybeSingle = vi.fn().mockResolvedValueOnce({
        data: {
          voice_session_id: 'voice-session-1',
          voice_call_sessions: {
            id: 'voice-session-1',
            conversation_state: {
              turnCount: 2,
              currentLanguage: 'en',
              cart: [],
              checkoutFields: { phone: '+919876543210' },
              messages: [],
            },
            expires_at: futureDate,
          },
        },
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      mockFrom.mockReturnValue({ select: mockSelect });

      const result = await getOrCreateSession('+919876543210');
      expect(result.voiceSessionId).toBe('voice-session-1');
      expect(result.state.turnCount).toBe(2);
      expect(mockFrom).toHaveBeenCalledTimes(1);
      expect(mockFrom).toHaveBeenCalledWith('whatsapp_sessions');
    });

    it('fallback path: executes secondary read if join was not embedded', async () => {
      const futureDate = new Date(Date.now() + 3600_000).toISOString();
      // First call returns waRow without voice_call_sessions
      const mockMaybeSingle1 = vi.fn().mockResolvedValueOnce({
        data: {
          voice_session_id: 'voice-session-fallback',
        },
        error: null,
      });
      const mockEq1 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle1 });
      const mockSelect1 = vi.fn().mockReturnValue({ eq: mockEq1 });

      // Second call queries voice_call_sessions directly
      const mockMaybeSingle2 = vi.fn().mockResolvedValueOnce({
        data: {
          id: 'voice-session-fallback',
          conversation_state: {
            turnCount: 1,
            currentLanguage: 'hi',
            cart: [],
            checkoutFields: {},
            messages: [],
          },
          expires_at: futureDate,
        },
        error: null,
      });
      const mockEq2 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle2 });
      const mockSelect2 = vi.fn().mockReturnValue({ eq: mockEq2 });

      mockFrom
        .mockReturnValueOnce({ select: mockSelect1 })
        .mockReturnValueOnce({ select: mockSelect2 });

      const result = await getOrCreateSession('+919876543210');
      expect(result.voiceSessionId).toBe('voice-session-fallback');
      expect(result.state.currentLanguage).toBe('hi');
      expect(mockFrom).toHaveBeenCalledTimes(2);
      expect(mockFrom).toHaveBeenNthCalledWith(1, 'whatsapp_sessions');
      expect(mockFrom).toHaveBeenNthCalledWith(2, 'voice_call_sessions');
    });

    it('creates fresh session when previous session is expired', async () => {
      const pastDate = new Date(Date.now() - 3600_000).toISOString();
      const mockMaybeSingle = vi.fn().mockResolvedValueOnce({
        data: {
          voice_session_id: 'expired-session',
          voice_call_sessions: {
            id: 'expired-session',
            conversation_state: { turnCount: 5 },
            expires_at: pastDate,
          },
        },
        error: null,
      });
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

      // Insert fresh voice session
      const mockSingle = vi.fn().mockResolvedValueOnce({
        data: { id: 'new-voice-session' },
        error: null,
      });
      const mockInsertSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockInsertSelect });

      // Upsert whatsapp_sessions
      const mockUpsert = vi.fn().mockResolvedValueOnce({ error: null });

      mockFrom
        .mockReturnValueOnce({ select: mockSelect })
        .mockReturnValueOnce({ insert: mockInsert })
        .mockReturnValueOnce({ upsert: mockUpsert });

      const result = await getOrCreateSession('+919876543210');
      expect(result.voiceSessionId).toBe('new-voice-session');
      expect(result.state.turnCount).toBe(0);
      expect(mockInsert).toHaveBeenCalled();
      expect(mockUpsert).toHaveBeenCalled();
    });
  });
});
