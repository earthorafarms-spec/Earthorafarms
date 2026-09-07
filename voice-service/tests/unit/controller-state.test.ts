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

import { processTurn, shouldPrefetchProductCatalog } from '../../src/conversation/controller.js';
import { WHATSAPP_MENU } from '../../../whatsapp-chatbot/prompt.js';

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

  it.each([
    'Tell me about Morilife+',
    'What are its benefits?',
    'इसके फायदे क्या हैं?',
    'તેના ફાયદા શું છે?',
  ])('recognizes product-knowledge wording for deterministic prefetch: %s', (question) => {
    expect(shouldPrefetchProductCatalog(question)).toBe(true);
  });

  it('returns the WhatsApp menu deterministically for a text greeting', async () => {
    const outcome = await processTurn('controller-test', createInitialState(), 'Hi', 'text');

    expect(outcome.replyText).toBe(
      `Hello! How can I assist you today? If you have any questions or need help with our products, feel free to ask!\n\n${WHATSAPP_MENU}`
    );
    expect(chatMock).not.toHaveBeenCalled();
    expect(productRepositoryMocks.listActiveProducts).not.toHaveBeenCalled();
  });

  it('returns one complete welcome and menu again for a second text greeting', async () => {
    const state = createInitialState();
    await processTurn('controller-test', state, 'Hi', 'text');

    const outcome = await processTurn('controller-test', state, 'Hi', 'text');

    expect(outcome.replyText).toBe(
      `Hello! How can I assist you today? If you have any questions or need help with our products, feel free to ask!\n\n${WHATSAPP_MENU}`
    );
    expect(outcome.replyText.split(WHATSAPP_MENU)).toHaveLength(2);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('returns the WhatsApp menu for an explicit menu request in the current language', async () => {
    const outcome = await processTurn('controller-test', createInitialState(), 'મુખ્ય મેનુ બતાવો', 'text');

    expect(outcome.replyText).toBe(`નમસ્તે!\n\n${WHATSAPP_MENU}`);
    expect(chatMock).not.toHaveBeenCalled();
    expect(productRepositoryMocks.listActiveProducts).not.toHaveBeenCalled();
  });

  it('does not replace active quantity or checkout flows with the menu for a greeting', async () => {
    chatMock
      .mockResolvedValueOnce({ kind: 'message', content: 'How many units would you like?' })
      .mockResolvedValueOnce({ kind: 'message', content: 'What is your full name?' });
    const state = createInitialState();
    state.messages.push({ role: 'assistant', content: 'You selected Alpha. How many units would you like?' });

    const quantityOutcome = await processTurn('controller-test', state, 'Hi', 'text');

    expect(quantityOutcome.replyText).toBe('How many units would you like?');
    expect(quantityOutcome.replyText).not.toContain(WHATSAPP_MENU);

    const checkoutState = createInitialState();
    checkoutState.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
    checkoutState.messages.push({ role: 'assistant', content: 'What is your full name?' });
    const checkoutOutcome = await processTurn('checkout-controller-test', checkoutState, 'Hi', 'text');

    expect(checkoutOutcome.replyText).toBe('What is your full name?');
    expect(checkoutOutcome.replyText).not.toContain(WHATSAPP_MENU);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it('leaves voice greeting handling in the LLM flow', async () => {
    chatMock.mockResolvedValueOnce({ kind: 'message', content: 'Hello! How can I help you today?' });

    const outcome = await processTurn('controller-test', createInitialState(), 'Hi', 'voice');

    expect(outcome.replyText).toBe('Hello! How can I help you today?');
    expect(outcome.replyText).not.toContain(WHATSAPP_MENU);
    expect(chatMock).toHaveBeenCalledTimes(1);
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
    expect(outcome.replyText).not.toContain('किस प्रोडक्ट');
    expect(outcome.replyText).toContain('ऑर्डर');
    expect(outcome.policyViolations).toEqual([]);
    expect(productRepositoryMocks.listActiveProducts).toHaveBeenCalledTimes(1);
    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.state.currentTurnFacts[0]?.toolName).toBe('list_products');
  });

  it('uses singular English wording when only one live product exists', async () => {
    const outcome = await processTurn('controller-test', createInitialState(), 'What products do you sell?');

    expect(outcome.replyText).toBe('We currently offer Alpha. Would you like to hear about it or order it?');
    expect(outcome.replyText.toLowerCase()).not.toContain('which one');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('deterministically grounds a voice product-information question in website and admin data', async () => {
    chatMock.mockResolvedValueOnce({
      kind: 'message',
      content: 'Alpha has approved information about immunity support.',
    });

    const outcome = await processTurn('controller-test', createInitialState(), 'Tell me about Alpha');

    expect(outcome.replyText).toContain('approved information');
    expect(productRepositoryMocks.getProductById).toHaveBeenCalledWith('alpha-id');
    expect(knowledgeRepositoryMocks.getAllApprovedKnowledge).toHaveBeenCalledWith('alpha-id');
    expect(outcome.state.currentTurnFacts.map((fact) => fact.toolName)).toEqual([
      'list_products', 'get_product_details', 'get_product_knowledge',
    ]);
    const messages = chatMock.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages.some((message) => message.content.includes('LIVE ADMIN-APPROVED KNOWLEDGE'))).toBe(true);
  });

  it('answers pregnancy questions directly from the live approved warning', async () => {
    knowledgeRepositoryMocks.getAllApprovedKnowledge.mockResolvedValue([{
      id: 'warning-1', productId: 'alpha-id', category: 'warnings', question: null,
      content: 'Consult a doctor before using Alpha during pregnancy or breastfeeding, if you have health problems, or take regular medicines.',
      version: 1, locale: 'en-IN',
    }]);
    const state = createInitialState();
    state.currentLanguage = 'hi';
    state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];

    const outcome = await processTurn('controller-test', state, 'क्या प्रेग्नेंट महिलाएं इसे ले सकती हैं?');

    expect(outcome.replyText).toContain('डॉक्टर से सलाह लें');
    expect(outcome.replyText).toContain('गर्भावस्था');
    expect(outcome.state.currentTurnFacts.map((fact) => fact.toolName)).toEqual([
      'list_products', 'get_product_details', 'get_product_knowledge',
    ]);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('turns menu option 1 into a numbered live product list', async () => {
    productRepositoryMocks.listActiveProducts.mockResolvedValue([
      {
        id: 'alpha-id', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
        status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '', badge: '',
        description: '', highlights: [], imageUrl: 'https://cdn.example.com/alpha.png',
      },
      {
        id: 'beta-id', slug: 'beta', name: 'Beta', mrp: 120, price: 110,
        status: 'active', stockQty: 4, stockLabel: 'Low Stock', tag: '', badge: '',
        description: '', highlights: [], imageUrl: 'https://cdn.example.com/beta.png',
      },
    ]);
    const state = createInitialState();
    state.messages.push({ role: 'assistant', content: `Hello!\n\n${WHATSAPP_MENU}` });

    const outcome = await processTurn('controller-test', state, '1', 'text');

    expect(outcome.replyText).toContain('1. Alpha — ₹90 — In Stock');
    expect(outcome.replyText).toContain('2. Beta — ₹110 — Low Stock');
    expect(outcome.replyText).toContain('Reply with the product number.');
    expect(productRepositoryMocks.listActiveProducts).toHaveBeenCalledTimes(1);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('resolves a numbered product reply and exposes its native image', async () => {
    const products = [
      {
        id: 'alpha-id', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
        status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '', badge: '',
        description: '', highlights: [], imageUrl: 'https://cdn.example.com/alpha.png',
      },
      {
        id: 'beta-id', slug: 'beta', name: 'Beta', mrp: 120, price: 110,
        status: 'active', stockQty: 4, stockLabel: 'Low Stock', tag: '', badge: '',
        description: 'Beta details', highlights: [], imageUrl: 'https://cdn.example.com/beta.png',
      },
    ];
    productRepositoryMocks.listActiveProducts.mockResolvedValue([products[1], products[0]]);
    productRepositoryMocks.getProductById.mockImplementation(async (id: string) =>
      products.find((product) => product.id === id) ?? null
    );
    chatMock.mockResolvedValueOnce({ kind: 'message', content: 'You selected Beta. How many units would you like?' });
    const state = createInitialState();
    state.messages.push({
      role: 'assistant',
      content: '1. Alpha — ₹90 — In Stock\n2. Beta — ₹110 — Low Stock\n\nReply with the product number.',
    });

    const outcome = await processTurn('controller-test', state, '2', 'text');

    expect(productRepositoryMocks.getProductById).toHaveBeenCalledWith('beta-id');
    expect(outcome.productImage).toEqual({ url: 'https://cdn.example.com/beta.png', caption: 'Beta' });
    expect(outcome.replyText).toContain('How many');
    const messages = chatMock.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages.some((message) => message.content.includes('numeric reply selected product option 2, Beta'))).toBe(true);
  });

  it('does not treat a quantity as a product selection', async () => {
    chatMock.mockResolvedValueOnce({ kind: 'message', content: 'I will add one Alpha to your cart.' });
    const state = createInitialState();
    state.messages.push({ role: 'assistant', content: 'You selected Alpha. How many units would you like?' });

    const outcome = await processTurn('controller-test', state, '1', 'text');

    expect(productRepositoryMocks.getProductById).not.toHaveBeenCalled();
    expect(outcome.productImage).toBeUndefined();
    const messages = chatMock.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages.some((message) => message.content.includes('numeric reply selected product option'))).toBe(false);
  });

  it('answers cart quantity from durable state without relying on model memory', async () => {
    const state = createInitialState();
    state.currentLanguage = 'hi';
    state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 3, unitPrice: 90 }];

    const outcome = await processTurn('controller-test', state, 'मेरे कार्ट में कितनी बॉटल हैं?');

    expect(outcome.replyText).toContain('तीन Alpha');
    expect(outcome.replyText).not.toContain('खाली');
    expect(outcome.state.currentTurnFacts.map((fact) => fact.toolName)).toEqual(['get_cart']);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('always asks the next checkout question after adding an item', async () => {
    chatMock
      .mockResolvedValueOnce({
        kind: 'tool_calls',
        calls: [{ id: 'add-1', name: 'add_cart_item', argumentsJson: JSON.stringify({ productId: 'alpha-id', quantity: 3 }) }],
      })
      .mockResolvedValueOnce({
        kind: 'message',
        content: 'I added three packs to your cart. I will take a few delivery details.',
      });

    const outcome = await processTurn('controller-test', createInitialState(), 'I want three packs of Alpha');

    expect(outcome.state.cart[0]).toMatchObject({ productId: 'alpha-id', quantity: 3 });
    expect(outcome.replyText).toContain('What is your full name?');
  });

  it('requires exact ten-digit phone confirmation before saving it', async () => {
    const state = createInitialState();
    state.currentLanguage = 'hi';
    state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
    state.checkoutFields = { name: 'Test User', email: 'test@example.com' };

    const incomplete = await processTurn('controller-test', state, 'सात नौ चार सात छह नौ चार सात दो');
    expect(incomplete.replyText).toContain('पूरा नहीं');
    expect(incomplete.state.checkoutFields.phone).toBeUndefined();

    const heard = await processTurn('controller-test', incomplete.state, 'सात नौ आठ चार सात छह नौ चार सात दो');
    expect(heard.replyText).toContain('क्या यह सही है?');
    expect(heard.state.pendingDigitConfirmation).toEqual({ field: 'phone', value: '+917984769472' });
    expect(heard.state.checkoutFields.phone).toBeUndefined();

    const confirmed = await processTurn('controller-test', heard.state, 'हाँ');
    expect(confirmed.state.pendingDigitConfirmation).toBeUndefined();
    expect(confirmed.state.checkoutFields.phone).toBe('+917984769472');
    expect(confirmed.replyText).toContain('स्ट्रीट एड्रेस');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('requires exactly six confirmed PIN-code digits', async () => {
    const state = createInitialState();
    state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
    state.checkoutFields = {
      name: 'Test User', email: 'test@example.com', phone: '+917984769472',
      address: '1 Test Road', city: 'Ahmedabad', state: 'Gujarat',
    };

    const incomplete = await processTurn('controller-test', state, '38447');
    expect(incomplete.replyText).toContain('six digits');
    expect(incomplete.state.checkoutFields.postalCode).toBeUndefined();

    const heard = await processTurn('controller-test', incomplete.state, '384470');
    expect(heard.state.pendingDigitConfirmation).toEqual({ field: 'postalCode', value: '384470' });
    const confirmed = await processTurn('controller-test', heard.state, 'yes');
    expect(confirmed.state.checkoutFields.postalCode).toBe('384470');
    expect(confirmed.replyText).toContain('delivery address in India');
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
