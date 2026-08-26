import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../src/conversation/state.js';
import { resetGuardState } from '../../src/conversation/output-policy.js';

const chatMock = vi.fn();

vi.mock('../../src/providers.js', () => ({
  chatWithRouting: (...args: unknown[]) => chatMock(...args),
}));

import { processTurn } from '../../src/conversation/controller.js';

describe('processTurn persisted state', () => {
  beforeEach(() => {
    chatMock.mockReset();
    resetGuardState('controller-test');
  });

  it('keeps output-policy correction instructions turn-local', async () => {
    chatMock
      .mockResolvedValueOnce({ kind: 'message', content: 'It costs ₹5000.' })
      .mockResolvedValueOnce({ kind: 'message', content: 'I need to check the current price first.' });

    const outcome = await processTurn('controller-test', createInitialState(), 'What does it cost?');

    expect(outcome.state.messages.some((m) => m.role === 'system' && m.content.includes('[Correction]'))).toBe(false);
    expect(outcome.replyText).toBe('I need to check the current price first.');
    expect(chatMock).toHaveBeenCalledTimes(2);
    const secondMessages = chatMock.mock.calls[1][0] as { role: string; content: string }[];
    expect(secondMessages.some((m) => m.role === 'system' && m.content.includes('[Correction]'))).toBe(true);
  });
});

