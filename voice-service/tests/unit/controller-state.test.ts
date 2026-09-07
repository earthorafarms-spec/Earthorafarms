import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../src/conversation/state.js';
import { resetGuardState } from '../../src/conversation/output-policy.js';

const chatMock = vi.fn();
const productRepositoryMocks = vi.hoisted(() => ({
  listActiveProducts: vi.fn(),
  getProductById: vi.fn(),
  listActiveFestivalDeals: vi.fn(),
}));
const knowledgeRepositoryMocks = vi.hoisted(() => ({
  getApprovedKnowledge: vi.fn(),
  getAllApprovedKnowledge: vi.fn(),
}));

vi.mock('../../src/providers.js', () => ({
  chatWithRouting: (...args: unknown[]) => chatMock(...args),
}));
vi.mock('../../src/repositories/products.repository.js', () => productRepositoryMocks);
vi.mock('../../src/repositories/knowledge.repository.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/repositories/knowledge.repository.js')>()),
  ...knowledgeRepositoryMocks,
}));

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
        imageUrl: 'https://cdn.example.com/alpha-primary.png',
      },
    ]);
    productRepositoryMocks.listActiveFestivalDeals.mockResolvedValue([]);
    productRepositoryMocks.getProductById.mockResolvedValue({
      id: 'alpha-id', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
      status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '120 caps', badge: '',
      description: 'Live website description', highlights: ['Live website highlight'],
      imageUrl: 'https://cdn.example.com/alpha-primary.png',
    });
    knowledgeRepositoryMocks.getApprovedKnowledge.mockReset();
    knowledgeRepositoryMocks.getAllApprovedKnowledge.mockReset();
    knowledgeRepositoryMocks.getAllApprovedKnowledge.mockResolvedValue([{
      id: 'knowledge-1', productId: 'alpha-id', category: 'benefits', question: null,
      content: 'Admin-approved immunity support information.', version: 2, locale: 'en-IN',
    }]);
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

  it('grounds a terse WhatsApp product selection in fresh website and admin data', async () => {
    chatMock.mockResolvedValueOnce({
      kind: 'message',
      content: 'Alpha is in stock at ₹90 and has approved information about immunity support.',
    });

    const outcome = await processTurn('controller-test', createInitialState(), 'Alpha', 'text');

    expect(outcome.replyText).toContain('₹90');
    expect(outcome.replyText).not.toContain("don't have a confirmed answer");
    expect(productRepositoryMocks.listActiveProducts).toHaveBeenCalledTimes(1);
    expect(productRepositoryMocks.getProductById).toHaveBeenCalledWith('alpha-id');
    expect(knowledgeRepositoryMocks.getAllApprovedKnowledge).toHaveBeenCalledWith('alpha-id');
    const messages = chatMock.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages.some((message) => message.role === 'system' && message.content.includes('LIVE WEBSITE DETAILS'))).toBe(true);
    expect(messages.some((message) => message.role === 'system' && message.content.includes('LIVE ADMIN-APPROVED KNOWLEDGE'))).toBe(true);
    expect(messages.some((message) => message.role === 'system' && message.content.includes('polished, natural customer-facing sentences'))).toBe(true);
    expect(outcome.productImage).toEqual({
      url: 'https://cdn.example.com/alpha-primary.png',
      caption: 'Alpha',
    });
    expect(outcome.state.currentTurnFacts.map((fact) => fact.toolName)).toEqual([
      'list_products', 'get_product_details', 'get_product_knowledge',
    ]);
  });

  it('regenerates a single-product knowledge dump as connected prose', async () => {
    chatMock
      .mockResolvedValueOnce({
        kind: 'message',
        content: '### Benefits\n- Immunity: Approved support information.\n- Dosage: Take as directed.',
      })
      .mockResolvedValueOnce({
        kind: 'message',
        content: 'Alpha is designed to provide the approved support described for this product. Take it only as directed.',
      });

    const outcome = await processTurn('controller-test', createInitialState(), 'Tell me about Alpha', 'text');

    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(outcome.replyText).not.toMatch(/^###|^- /m);
    const messages = chatMock.mock.calls[1][0] as { role: string; content: string }[];
    expect(messages.some((message) => message.content.includes('[Formatting correction]'))).toBe(true);
  });
});
