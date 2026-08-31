import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../src/conversation/state.js';
import { resetGuardState } from '../../src/conversation/output-policy.js';

const chatMock = vi.fn();
const productRepositoryMocks = vi.hoisted(() => ({
  listActiveProducts: vi.fn(),
  getProductById: vi.fn(),
  listActiveFestivalDeals: vi.fn(),
}));

vi.mock('../../src/providers.js', () => ({
  chatWithRouting: (...args: unknown[]) => chatMock(...args),
}));
vi.mock('../../src/repositories/products.repository.js', () => productRepositoryMocks);

import { processTurn } from '../../src/conversation/controller.js';

describe('processTurn persisted state', () => {
  beforeEach(() => {
    chatMock.mockReset();
    resetGuardState('controller-test');
    productRepositoryMocks.listActiveProducts.mockClear();
    productRepositoryMocks.getProductById.mockClear();
    productRepositoryMocks.listActiveFestivalDeals.mockClear();
    productRepositoryMocks.listActiveProducts.mockResolvedValue([
      {
        id: 'alpha-id', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
        status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '120 caps', badge: '',
        description: 'Alpha description', highlights: [],
      },
    ]);
    productRepositoryMocks.listActiveFestivalDeals.mockResolvedValue([]);
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

  it('answers a simple product-list question directly from the fresh catalog', async () => {
    const state = createInitialState();
    state.currentLanguage = 'hi';

    const outcome = await processTurn('controller-test', state, 'आपके पास कौन से प्रोडक्ट्स उपलब्ध हैं?');

    expect(outcome.replyText).toContain('Alpha');
    expect(outcome.replyText).toContain('किस प्रोडक्ट');
    expect(outcome.policyViolations).toEqual([]);
    expect(productRepositoryMocks.listActiveProducts).toHaveBeenCalledTimes(1);
    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.state.currentTurnFacts[0]?.toolName).toBe('list_products');
  });

  it('keeps detailed product questions in the model and tool loop', async () => {
    chatMock.mockResolvedValueOnce({ kind: 'message', content: 'Which product price would you like me to check?' });

    await processTurn('controller-test', createInitialState(), 'What is the price of your available products?');

    expect(productRepositoryMocks.listActiveProducts).toHaveBeenCalledTimes(1);
    expect(chatMock).toHaveBeenCalledTimes(1);
    const messages = chatMock.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages.some((m) => m.role === 'system' && m.content.includes('LIVE PRODUCT CATALOG FOR THIS TURN'))).toBe(true);
  });
});
