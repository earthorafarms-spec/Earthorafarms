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
import {
  WHATSAPP_MENU,
  WHATSAPP_POLICIES_MENU,
  WHATSAPP_SHIPPING_POLICY,
  WHATSAPP_RETURN_POLICY,
} from '../../../whatsapp-chatbot/prompt.js';
import {
  cartButtonId,
  productActionInputFromButtonId,
  productButtonId,
} from '../../../whatsapp-chatbot/product-card.js';

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

  it('handles common greeting variants deterministically without invoking the LLM', async () => {
    const variants = ['hi there', 'hello there', 'hii', 'helo', 'hey there', 'namaste ji', 'kem cho', 'नमस्ते जी'];
    for (const greeting of variants) {
      chatMock.mockClear();
      const outcome = await processTurn('controller-test', createInitialState(), greeting, 'text');
      expect(outcome.replyText).toContain(WHATSAPP_MENU);
      expect(chatMock).not.toHaveBeenCalled();
    }
  });

  it('returns the WhatsApp menu for a greeting after product browsing and resets product context', async () => {
    const state = createInitialState();
    state.messages.push({
      role: 'assistant',
      content: '1. Alpha — ₹90 (Tax Included) — In Stock\n\nReply with the product number.\nTo return to the main menu, type Menu.',
    });
    state.whatsAppProductContext = { productId: 'alpha-id', productName: 'Alpha', awaitingQuantity: false };

    const outcome = await processTurn('controller-test', state, 'Hello', 'text');

    expect(outcome.replyText).toContain(WHATSAPP_MENU);
    expect(outcome.state.whatsAppProductContext).toBeUndefined();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('deterministically routes "menu", "main menu", "back", and "0" to the main menu and resets product context', async () => {
    const triggers = ['menu', 'Menu', 'main menu', 'Main Menu', 'back', 'Back', '0', ' 0 '];
    for (const trigger of triggers) {
      chatMock.mockClear();
      const state = createInitialState();
      state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
      state.checkoutFields = { name: 'Test User' };
      state.whatsAppProductContext = { productId: 'alpha-id', productName: 'Alpha', awaitingQuantity: false };

      const outcome = await processTurn('controller-test', state, trigger, 'text');

      expect(outcome.replyText).toContain(WHATSAPP_MENU);
      expect(outcome.state.whatsAppProductContext).toBeUndefined();
      expect(outcome.state.cart).toEqual([{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }]);
      expect(outcome.state.checkoutFields.name).toBe('Test User');
      expect(chatMock).not.toHaveBeenCalled();
    }
  });

  it('does not treat "0" as an invalid product selection number when browsing products', async () => {
    const state = createInitialState();
    state.messages.push({
      role: 'assistant',
      content: '1. Alpha — ₹90 (Tax Included) — In Stock\n\nReply with the product number.',
    });

    const outcome = await processTurn('controller-test', state, '0', 'text');

    expect(outcome.replyText).toContain(WHATSAPP_MENU);
    expect(outcome.replyText).not.toContain('That is not a valid product number');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it.each(['Hi', 'Hello'])('returns the main menu for a dormant persisted cart on %s', async (greeting) => {
    const state = createInitialState();
    state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
    state.checkoutFields = { phone: '+919876543210', name: 'Test User' };
    // This was the previous checkout prompt when name had not yet been saved.
    // The current prompt is now email, so it must not suppress the main menu.
    state.messages.push({ role: 'assistant', content: 'What is your full name?' });

    const outcome = await processTurn('dormant-cart-test', state, greeting, 'text');

    expect(outcome.replyText).toContain(WHATSAPP_MENU);
    expect(outcome.state.cart).toEqual([{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }]);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('does not replace active quantity collection with the menu for a greeting', async () => {
    chatMock.mockResolvedValueOnce({ kind: 'message', content: 'How many units would you like?' });
    const state = createInitialState();
    state.messages.push({ role: 'assistant', content: 'You selected Alpha. How many units would you like?' });

    const quantityOutcome = await processTurn('controller-test', state, 'Hi', 'text');

    expect(quantityOutcome.replyText).toBe('How many units would you like?');
    expect(quantityOutcome.replyText).not.toContain(WHATSAPP_MENU);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it('does not replace active checkout field collection with the menu for a greeting', async () => {
    chatMock.mockResolvedValueOnce({ kind: 'message', content: 'What is your full name?' });
    const checkoutState = createInitialState();
    checkoutState.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
    checkoutState.messages.push({ role: 'assistant', content: 'What is your full name?' });

    const checkoutOutcome = await processTurn('checkout-controller-test', checkoutState, 'Hi', 'text');

    expect(checkoutOutcome.replyText).toBe('What is your full name?');
    expect(checkoutOutcome.replyText).not.toContain(WHATSAPP_MENU);
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it('uses a safe clarification for a voice greeting instead of an unsolicited product pitch', async () => {
    const outcome = await processTurn('controller-test', createInitialState(), 'Hi', 'voice');

    expect(outcome.replyText).toBe('Hello! I can help with product information or an order. What would you like to know?');
    expect(outcome.replyText).not.toContain(WHATSAPP_MENU);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('waits for the first substantive sentence before establishing the call language', async () => {
    const state = createInitialState();
    const greeting = await processTurn('controller-test', state, 'नमस्ते', 'voice');
    expect(greeting.state.languageEstablished).toBe(false);

    chatMock.mockResolvedValueOnce({ kind: 'message', content: 'Here is the product information.' });
    const sentence = await processTurn('controller-test', greeting.state, 'I want to ask about the product details.', 'voice');
    expect(sentence.state.currentLanguage).toBe('en');
    expect(sentence.state.languageEstablished).toBe(true);
  });

  it('keeps output-policy correction instructions turn-local', async () => {
    chatMock
      .mockResolvedValueOnce({ kind: 'message', content: 'It costs ₹5000.' })
      .mockResolvedValueOnce({ kind: 'message', content: 'I need to check the current price first.' });

    const outcome = await processTurn('controller-test', createInitialState(), 'Tell me about Alpha');

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

    expect(outcome.replyText).toContain('1. Alpha — ₹90 (Tax Included) — In Stock');
    expect(outcome.replyText).toContain('2. Beta — ₹110 (Tax Included) — Low Stock');
    expect(outcome.replyText).toContain('Reply with the product number.');
    expect(productRepositoryMocks.listActiveProducts).toHaveBeenCalledTimes(1);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('keeps greeting then menu option 1 deterministic', async () => {
    const state = createInitialState();

    const greeting = await processTurn('controller-test', state, 'Hello', 'text');
    const catalog = await processTurn('controller-test', state, '1', 'text');

    expect(greeting.replyText).toContain(WHATSAPP_MENU);
    expect(catalog.replyText).toContain('1. Alpha — ₹90 (Tax Included) — In Stock');
    expect(catalog.replyText).toContain('Reply with the product number.');
    expect(productRepositoryMocks.listActiveProducts).toHaveBeenCalledTimes(1);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('resolves a numbered product reply into a native interactive product card', async () => {
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
    const state = createInitialState();
    state.messages.push({
      role: 'assistant',
      content: '1. Alpha — ₹90 (Tax Included) — In Stock\n2. Beta — ₹110 (Tax Included) — Low Stock\n\nReply with the product number.',
    });

    const outcome = await processTurn('controller-test', state, '2', 'text');

    expect(productRepositoryMocks.getProductById).toHaveBeenCalledWith('beta-id');
    expect(outcome.productImage).toEqual({ url: 'https://cdn.example.com/beta.png', caption: 'Beta' });
    expect(outcome.productCard).toEqual({
      productId: 'beta-id',
      imageUrl: 'https://cdn.example.com/beta.png',
      name: 'Beta',
      body: '*Beta*\n₹110 (Tax Included) • MRP ₹120 • Low Stock\nBeta details\nTo return to the main menu, type Menu.',
    });
    expect(outcome.replyText).toBe(outcome.productCard?.body);
    expect(outcome.state.whatsAppProductContext).toEqual({
      productId: 'beta-id', productName: 'Beta', awaitingQuantity: false,
    });
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('resolves a numbered product reply into a deterministic product card even when imageUrl is missing without invoking LLM fallback', async () => {
    const products = [
      {
        id: 'no-img-id', slug: 'no-img', name: 'No Image Product', mrp: 150, price: 120,
        status: 'active', stockQty: 8, stockLabel: 'In Stock', tag: '', badge: '',
        description: 'Details without image', highlights: [], imageUrl: null,
      },
    ];
    productRepositoryMocks.listActiveProducts.mockResolvedValue(products);
    productRepositoryMocks.getProductById.mockImplementation(async (id: string) =>
      products.find((product) => product.id === id) ?? null
    );
    const state = createInitialState();
    state.messages.push({
      role: 'assistant',
      content: '1. No Image Product — ₹120 (Tax Included) — In Stock\n\nReply with the product number.',
    });

    const outcome = await processTurn('controller-test', state, '1', 'text');

    expect(productRepositoryMocks.getProductById).toHaveBeenCalledWith('no-img-id');
    expect(outcome.productImage).toBeUndefined();
    expect(outcome.productCard).toEqual({
      productId: 'no-img-id',
      name: 'No Image Product',
      body: '*No Image Product*\n₹120 (Tax Included) • MRP ₹150 • In Stock\nDetails without image\nTo return to the main menu, type Menu.',
    });
    expect(outcome.replyText).toBe(outcome.productCard?.body);
    expect(outcome.state.whatsAppProductContext).toEqual({
      productId: 'no-img-id', productName: 'No Image Product', awaitingQuantity: false,
    });
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('handles the Benefits product-card button from approved product knowledge deterministically without invoking the LLM', async () => {
    const input = productActionInputFromButtonId(productButtonId('benefits', 'alpha-id'))!;

    const outcome = await processTurn('controller-test', createInitialState(), input, 'text');

    expect(outcome.replyText).toContain('Admin-approved immunity support information.');
    expect(outcome.replyText).toContain('*Benefits of Alpha:*');
    expect(knowledgeRepositoryMocks.getAllApprovedKnowledge).toHaveBeenCalledWith('alpha-id');
    expect(outcome.state.currentTurnFacts.map((fact) => fact.toolName)).toEqual([
      'list_products', 'get_product_details', 'get_product_knowledge',
    ]);
    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.state.messages.some((m) => m.role === 'user')).toBe(false);
    expect(outcome.state.whatsAppProductContext).toEqual({
      productId: 'alpha-id', productName: 'Alpha', awaitingQuantity: false, lastAction: 'benefits',
    });
  });

  it('handles the Dosage product-card button deterministically without invoking the LLM', async () => {
    knowledgeRepositoryMocks.getAllApprovedKnowledge.mockResolvedValueOnce([{
      id: 'knowledge-dose', productId: 'alpha-id', category: 'dosage', question: null,
      content: 'Take one capsule daily after food.', version: 1, locale: 'en-IN',
    }]);
    const input = productActionInputFromButtonId(productButtonId('dosage', 'alpha-id'))!;

    const outcome = await processTurn('controller-test', createInitialState(), input, 'text');

    expect(outcome.replyText).toContain('Take one capsule daily after food.');
    expect(outcome.replyText).toContain('*Dosage & Directions for Alpha:*');
    expect(knowledgeRepositoryMocks.getAllApprovedKnowledge).toHaveBeenCalledWith('alpha-id');
    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.state.messages.some((m) => m.role === 'user')).toBe(false);
    expect(outcome.state.whatsAppProductContext).toEqual({
      productId: 'alpha-id', productName: 'Alpha', awaitingQuantity: false, lastAction: 'dosage',
    });
  });

  it('returns grounded approved knowledge without invoking the LLM', async () => {
    const input = productActionInputFromButtonId(productButtonId('benefits', 'alpha-id'))!;

    const outcome = await processTurn('controller-test', createInitialState(), input, 'text');

    expect(outcome.replyText).toContain('Admin-approved immunity support information.');
    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.state.messages.some((m) => m.role === 'user')).toBe(false);
  });

  it('handles Benefits and Dosage from raw provider button ID strings', async () => {
    const rawButtonId = productButtonId('benefits', 'alpha-id');

    const outcome = await processTurn('controller-test', createInitialState(), rawButtonId, 'text');

    expect(outcome.replyText).toContain('Admin-approved immunity support information.');
    expect(knowledgeRepositoryMocks.getAllApprovedKnowledge).toHaveBeenCalledWith('alpha-id');
    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.state.messages.some((m) => m.role === 'user')).toBe(false);
    expect(outcome.state.whatsAppProductContext?.lastAction).toBe('benefits');
  });

  it('handles button text clicks ("Benefits", "Dosage") using active product context', async () => {
    const state = createInitialState();
    state.whatsAppProductContext = {
      productId: 'alpha-id',
      productName: 'Alpha',
      awaitingQuantity: false,
    };

    const outcome = await processTurn('controller-test', state, 'Benefits', 'text');

    expect(outcome.replyText).toContain('Admin-approved immunity support information.');
    expect(knowledgeRepositoryMocks.getAllApprovedKnowledge).toHaveBeenCalledWith('alpha-id');
    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.state.whatsAppProductContext?.lastAction).toBe('benefits');
    expect(outcome.state.messages.some((m) => m.role === 'user')).toBe(false);
  });

  it('does not hallucinate Benefits/Dosage when knowledge is unavailable', async () => {
    knowledgeRepositoryMocks.getAllApprovedKnowledge.mockResolvedValueOnce([]);
    const input = productActionInputFromButtonId(productButtonId('benefits', 'alpha-id'))!;

    const outcome = await processTurn('controller-test', createInitialState(), input, 'text');

    expect(outcome.replyText).toContain('Approved benefits information is not available for Alpha.');
    expect(knowledgeRepositoryMocks.getAllApprovedKnowledge).toHaveBeenCalledWith('alpha-id');
    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.state.messages.some((m) => m.role === 'user')).toBe(false);
  });

  it('handles Add to Cart deterministically and keeps the next number in the quantity flow', async () => {
    const state = createInitialState();
    state.checkoutFields.phone = '+919876543210';
    const input = productActionInputFromButtonId(productButtonId('add_to_cart', 'alpha-id'))!;

    const buttonOutcome = await processTurn('controller-test', state, input, 'text');

    expect(buttonOutcome.replyText).toBe('How many units of Alpha would you like to add to your cart?');
    expect(buttonOutcome.state.whatsAppProductContext?.awaitingQuantity).toBe(true);
    expect(buttonOutcome.state.whatsAppProductContext?.lastAction).toBe('add_to_cart');
    expect(buttonOutcome.state.messages.some((m) => m.role === 'user')).toBe(false);
    expect(chatMock).not.toHaveBeenCalled();

    const quantityOutcome = await processTurn('controller-test', state, '2', 'text');

    expect(quantityOutcome.state.cart).toEqual([
      { productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 },
    ]);
    expect(quantityOutcome.replyText).toContain('Alpha has been added to your cart.');
    expect(quantityOutcome.productCard?.buttons).toEqual([
      { id: 'earthora_cart:view_cart', title: 'View Cart' },
      { id: 'earthora_cart:checkout', title: 'Checkout' },
      { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
    ]);
    expect(quantityOutcome.state.whatsAppProductContext).toBeUndefined();
    expect(quantityOutcome.state.messages.some((m) => m.role === 'user' && m.content === '2')).toBe(true);
    expect(chatMock).not.toHaveBeenCalled();

    // From post-add confirmation, customer continues to checkout
    const checkoutOutcome = await processTurn(
      'controller-test',
      quantityOutcome.state,
      productActionInputFromButtonId(cartButtonId('checkout'))!,
      'text',
    );
    expect(checkoutOutcome.replyText).toContain('What is your full name?');
    expect(chatMock).not.toHaveBeenCalled();
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

  it('answers cart pricing with exact backend arithmetic instead of model-generated math', async () => {
    const state = createInitialState();
    state.currentLanguage = 'hi';
    state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 799 }];

    const outcome = await processTurn('controller-test', state, 'टोटल अमाउंट कितना है?');

    expect(outcome.replyText).toContain('₹799');
    expect(outcome.replyText).toContain('₹1,598');
    expect(outcome.replyText).not.toContain('1,518');
    expect(outcome.state.currentTurnFacts.map((fact) => fact.toolName)).toEqual(['get_cart']);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('switches from Hindi to a confident English utterance during checkout', async () => {
    const state = createInitialState();
    state.currentLanguage = 'hi';
    state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
    chatMock.mockResolvedValueOnce({ kind: 'message', content: 'What is your full name?' });

    const outcome = await processTurn('controller-test', state, 'Okay, can you place my order?');

    expect(outcome.state.currentLanguage).toBe('en');
    expect(outcome.replyText).toBe('What is your full name?');
    const messages = chatMock.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages[0].content).toContain('RESPONSE LANGUAGE FOR THIS REPLY: English');
  });

  it('always asks the next checkout question after adding an item', async () => {
    chatMock.mockResolvedValueOnce({
      kind: 'tool_calls',
      calls: [{ id: 'add-1', name: 'add_cart_item', argumentsJson: JSON.stringify({ productId: 'alpha-id', quantity: 3 }) }],
    });

    const outcome = await processTurn('controller-test', createInitialState(), 'I want three packs of Alpha');

    expect(outcome.state.cart[0]).toMatchObject({ productId: 'alpha-id', quantity: 3 });
    expect(outcome.replyText).toContain('₹90');
    expect(outcome.replyText).toContain('₹270');
    expect(outcome.replyText).toContain('What is your full name?');
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it('requires exact ten-digit phone confirmation before saving it', async () => {
    const state = createInitialState();
    state.currentLanguage = 'hi';
    state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
    state.checkoutFields = { name: 'Test User', email: 'test@example.com' };

    const incomplete = await processTurn('controller-test', state, 'सात नौ चार सात छह नौ चार सात दो');
    expect(incomplete.replyText).toContain('पूरा नहीं');
    expect(incomplete.state.checkoutFields.phone).toBeUndefined();

    const heard = await processTurn('controller-test', incomplete.state, 'मेरा नंबर सात नौ आठ चार सात छह नौ चार सात दो है');
    expect(heard.replyText).toContain('क्या यह सही है?');
    expect(heard.state.pendingDigitConfirmation).toEqual({ field: 'phone', value: '+917984769472' });
    expect(heard.state.checkoutFields.phone).toBeUndefined();

    const confirmed = await processTurn('controller-test', heard.state, 'हाँ');
    expect(confirmed.state.pendingDigitConfirmation).toBeUndefined();
    expect(confirmed.state.checkoutFields.phone).toBe('+917984769472');
    expect(confirmed.replyText).toContain('स्ट्रीट एड्रेस');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('does not treat a repeated email as an incomplete phone number', async () => {
    const state = createInitialState();
    state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
    state.checkoutFields = { name: 'Test User', email: 'customer7@example.com' };

    const outcome = await processTurn('controller-test', state, 'customer7@example.com');

    expect(outcome.replyText).toContain('already saved your email address');
    expect(outcome.replyText).toContain('WhatsApp number');
    expect(outcome.state.checkoutFields.phone).toBeUndefined();
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

    const heard = await processTurn('controller-test', incomplete.state, 'my PIN is three eight four four seven zero');
    expect(heard.state.pendingDigitConfirmation).toEqual({ field: 'postalCode', value: '384470' });
    const confirmed = await processTurn('controller-test', heard.state, 'yes');
    expect(confirmed.state.checkoutFields.postalCode).toBe('384470');
    expect(confirmed.replyText).toContain('delivery address in India');
  });

  it('answers an unambiguous product price directly from the fresh website record', async () => {
    const outcome = await processTurn('controller-test', createInitialState(), 'What is the price of your available product?');

    expect(productRepositoryMocks.listActiveProducts).toHaveBeenCalledTimes(1);
    expect(outcome.replyText).toBe('Alpha costs ₹90, including tax.');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('handles Romanized Gujarati price and cart questions without losing durable cart state', async () => {
    const state = createInitialState();
    state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 3, unitPrice: 90 }];

    const price = await processTurn('controller-test', state, 'kimmat su che product ni', 'voice');
    expect(price.state.currentLanguage).toBe('gu');
    expect(price.replyText).toContain('₹90');

    const cart = await processTurn('controller-test', price.state, 'mara cart ma ketli bottle che', 'voice');
    expect(cart.state.cart).toEqual([{ productId: 'alpha-id', productName: 'Alpha', quantity: 3, unitPrice: 90 }]);
    expect(cart.replyText).toContain('₹270');
    expect(cart.replyText).not.toContain('ખાલી');
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('treats Romanized Gujarati agreement as a request for product details instead of repeating the offer', async () => {
    const state = createInitialState();
    state.currentLanguage = 'gu';
    state.languageEstablished = true;
    state.messages.push({ role: 'assistant', content: 'તમે પ્રોડક્ટ વિશે જાણવા માંગો છો કે ઓર્ડર કરવા માંગો છો?' });
    chatMock.mockResolvedValueOnce({ kind: 'message', content: 'આ પ્રોડક્ટની માન્ય માહિતી આ છે.' });

    const outcome = await processTurn('controller-test', state, 'ha mare janvu che', 'voice');

    expect(outcome.replyText).not.toMatch(/જાણવા.*ઓર્ડર/u);
    const messages = chatMock.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages.some((message) => message.role === 'system' && message.content.includes('Do not repeat the question'))).toBe(true);
  });

  it('instructs the model to answer benefits and cautions as separate grounded parts', async () => {
    chatMock.mockResolvedValueOnce({ kind: 'message', content: 'આના ફાયદા માન્ય માહિતી મુજબ આ છે. માન્ય ગેરફાયદા વિશે માહિતી ઉપલબ્ધ નથી.' });

    await processTurn('controller-test', createInitialState(), 'faayda and gerfaayda batavo product na', 'voice');

    const messages = chatMock.mock.calls[0][0] as { role: string; content: string }[];
    expect(messages.some((message) => message.role === 'system' && message.content.includes('BOTH benefits and disadvantages'))).toBe(true);
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

  describe('WhatsApp policy routing and price tax rules', () => {
    it('routes Main Menu option 3 deterministically to Policies Menu', async () => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: `Hello!\n\n${WHATSAPP_MENU}` });

      const outcome = await processTurn('controller-test', state, '3', 'text');

      expect(outcome.replyText).toBe(WHATSAPP_POLICIES_MENU);
      expect(outcome.state.whatsAppProductContext).toBeUndefined();
      expect(chatMock).not.toHaveBeenCalled();
    });

    it('routes Policies Menu option 1 deterministically to Shipping Policy', async () => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: WHATSAPP_POLICIES_MENU });

      const outcome = await processTurn('controller-test', state, '1', 'text');

      expect(outcome.replyText).toBe(WHATSAPP_SHIPPING_POLICY);
      expect(outcome.state.whatsAppProductContext).toBeUndefined();
      expect(chatMock).not.toHaveBeenCalled();
    });

    it('routes Policies Menu option 2 deterministically to Return & Cancellation Policy', async () => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: WHATSAPP_POLICIES_MENU });

      const outcome = await processTurn('controller-test', state, '2', 'text');

      expect(outcome.replyText).toBe(WHATSAPP_RETURN_POLICY);
      expect(outcome.state.whatsAppProductContext).toBeUndefined();
      expect(chatMock).not.toHaveBeenCalled();
    });

    it('routes Policies Menu option 0 deterministically to Main Menu', async () => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: WHATSAPP_POLICIES_MENU });

      const outcome = await processTurn('controller-test', state, '0', 'text');

      expect(outcome.replyText).toContain(WHATSAPP_MENU);
      expect(outcome.state.whatsAppProductContext).toBeUndefined();
      expect(chatMock).not.toHaveBeenCalled();
    });

    it('routes Policy screen back to Main Menu on "menu" and "0"', async () => {
      for (const policyContent of [WHATSAPP_SHIPPING_POLICY, WHATSAPP_RETURN_POLICY]) {
        for (const trigger of ['Menu', 'menu', '0', 'main menu']) {
          chatMock.mockClear();
          const state = createInitialState();
          state.messages.push({ role: 'assistant', content: policyContent });

          const outcome = await processTurn('controller-test', state, trigger, 'text');

          expect(outcome.replyText).toContain(WHATSAPP_MENU);
          expect(chatMock).not.toHaveBeenCalled();
        }
      }
    });

    it('formats price in catalog with (Tax Included)', async () => {
      productRepositoryMocks.listActiveProducts.mockResolvedValueOnce([
        {
          id: 'alpha-id', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
          status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '', badge: '',
          description: '', highlights: [], imageUrl: 'https://cdn.example.com/alpha.png',
        },
      ]);
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: `Hello!\n\n${WHATSAPP_MENU}` });

      const outcome = await processTurn('controller-test', state, '1', 'text');

      expect(outcome.replyText).toContain('1. Alpha — ₹90 (Tax Included) — In Stock');
      expect(outcome.replyText).not.toContain('₹90 — In Stock');
    });

    it('formats price in product card with (Tax Included) and preserves MRP benchmark semantics', async () => {
      const product = {
        id: 'beta-id', slug: 'beta', name: 'Beta', mrp: 120, price: 110,
        status: 'active', stockQty: 4, stockLabel: 'Low Stock', tag: '', badge: '',
        description: 'Beta details', highlights: [], imageUrl: 'https://cdn.example.com/beta.png',
      };
      productRepositoryMocks.listActiveProducts.mockResolvedValue([product]);
      productRepositoryMocks.getProductById.mockResolvedValue(product);
      const state = createInitialState();
      state.messages.push({
        role: 'assistant',
        content: '1. Beta — ₹110 (Tax Included) — Low Stock\n\nReply with the product number.',
      });

      const outcome = await processTurn('controller-test', state, '1', 'text');

      expect(outcome.productCard?.body).toContain('₹110 (Tax Included) • MRP ₹120 • Low Stock');
      expect(outcome.productCard?.body).not.toContain('MRP ₹120 (Tax Included)');
    });

    it('formats price in cart with (Tax Included)', async () => {
      const state = createInitialState();
      state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];

      const outcome = await processTurn('controller-test', state, 'what is in my cart', 'text');

      expect(outcome.replyText).toContain('Alpha at ₹90 (Tax Included) each');
      expect(outcome.replyText).toContain('The exact total is ₹180 (Tax Included).');
    });

    it('ensures existing checkout and quantity routing remains intact and does not trigger policies menu', async () => {
      // Case A: Awaiting quantity
      const stateQuantity = createInitialState();
      stateQuantity.whatsAppProductContext = {
        productId: 'alpha-id',
        productName: 'Alpha',
        awaitingQuantity: true,
      };
      stateQuantity.messages.push({
        role: 'assistant',
        content: 'How many units of Alpha would you like to add to your cart?',
      });

      const outcomeQuantity = await processTurn('controller-test', stateQuantity, '3', 'text');

      expect(outcomeQuantity.state.cart).toEqual([
        { productId: 'alpha-id', productName: 'Alpha', quantity: 3, unitPrice: 90 },
      ]);
      expect(outcomeQuantity.replyText).not.toContain('Shipping Policy');
      expect(outcomeQuantity.replyText).not.toBe(WHATSAPP_POLICIES_MENU);

      // Case B: Active checkout field collection
      chatMock.mockReset();
      chatMock.mockResolvedValueOnce({ kind: 'message', content: 'Thank you. What is your email address?' });
      const stateCheckout = createInitialState();
      stateCheckout.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
      stateCheckout.messages.push({
        role: 'assistant',
        content: 'Your cart has 1 Alpha at ₹90 (Tax Included) each, and the exact total is ₹90 (Tax Included). What is your full name?',
      });

      const outcomeCheckout = await processTurn('controller-test', stateCheckout, '3', 'text');

      expect(outcomeCheckout.replyText).not.toBe(WHATSAPP_POLICIES_MENU);
      expect(outcomeCheckout.replyText).not.toContain('Shipping Policy');
      expect(chatMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('WhatsApp post-add-to-cart deterministic buttons and cart navigation', () => {
    it('shows confirmation with 3 actions (View Cart, Checkout, Continue Shopping) after adding product and quantity', async () => {
      const state = createInitialState();
      const addInput = productActionInputFromButtonId(productButtonId('add_to_cart', 'alpha-id'))!;

      const step1 = await processTurn('controller-test', state, addInput, 'text');
      expect(step1.replyText).toBe('How many units of Alpha would you like to add to your cart?');
      expect(step1.state.whatsAppProductContext?.awaitingQuantity).toBe(true);

      const step2 = await processTurn('controller-test', step1.state, '2', 'text');
      expect(step2.replyText).toBe('Alpha has been added to your cart.');
      expect(step2.productCard).toBeDefined();
      expect(step2.productCard?.buttons).toEqual([
        { id: 'earthora_cart:view_cart', title: 'View Cart' },
        { id: 'earthora_cart:checkout', title: 'Checkout' },
        { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
      ]);
      expect(step2.state.cart).toEqual([
        { productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 },
      ]);
      expect(step2.state.whatsAppProductContext).toBeUndefined();
    });

    it('supports multilingual post-add-to-cart confirmation (Hindi & Gujarati)', async () => {
      // Hindi
      const stateHi = createInitialState();
      stateHi.currentLanguage = 'hi';
      const addInput = productActionInputFromButtonId(productButtonId('add_to_cart', 'alpha-id'))!;
      const stepHi1 = await processTurn('controller-test', stateHi, addInput, 'text');
      expect(stepHi1.replyText).toContain('Alpha');
      const stepHi2 = await processTurn('controller-test', stepHi1.state, '1', 'text');
      expect(stepHi2.replyText).toContain('Alpha कार्ट में जोड़ दिया है।');
      expect(stepHi2.productCard?.buttons).toEqual([
        { id: 'earthora_cart:view_cart', title: 'View Cart' },
        { id: 'earthora_cart:checkout', title: 'Checkout' },
        { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
      ]);

      // Gujarati
      const stateGu = createInitialState();
      stateGu.currentLanguage = 'gu';
      const stepGu1 = await processTurn('controller-test', stateGu, addInput, 'text');
      expect(stepGu1.replyText).toContain('Alpha');
      const stepGu2 = await processTurn('controller-test', stepGu1.state, '1', 'text');
      expect(stepGu2.replyText).toContain('Alpha કાર્ટમાં ઉમેર્યું છે.');
      expect(stepGu2.productCard?.buttons).toEqual([
        { id: 'earthora_cart:view_cart', title: 'View Cart' },
        { id: 'earthora_cart:checkout', title: 'Checkout' },
        { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
      ]);
    });

    it('navigates to View Cart and displays tax-inclusive prices and 3 action buttons', async () => {
      const state = createInitialState();
      state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
      state.messages.push({ role: 'assistant', content: 'Alpha has been added to your cart.' });

      // Action via native button click
      const outcomeButton = await processTurn(
        'controller-test',
        state,
        productActionInputFromButtonId(cartButtonId('view_cart'))!,
        'text',
      );
      expect(outcomeButton.replyText).toContain('two Alpha at ₹90 (Tax Included) each');
      expect(outcomeButton.replyText).toContain('The exact total is ₹180 (Tax Included).');
      expect(outcomeButton.productCard?.buttons).toEqual([
        { id: 'earthora_cart:remove_item', title: 'Remove Item' },
        { id: 'earthora_cart:checkout', title: 'Checkout' },
        { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
      ]);

      // Action via numeric reply '1'
      const stateNumber = createInitialState();
      stateNumber.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
      stateNumber.messages.push({ role: 'assistant', content: 'Alpha has been added to your cart.' });
      const outcomeNumber = await processTurn('controller-test', stateNumber, '1', 'text');
      expect(outcomeNumber.replyText).toContain('two Alpha at ₹90 (Tax Included) each');
      expect(outcomeNumber.replyText).toContain('The exact total is ₹180 (Tax Included).');

      // Action via text 'View Cart'
      const stateText = createInitialState();
      stateText.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
      stateText.messages.push({ role: 'assistant', content: 'Alpha has been added to your cart.' });
      const outcomeText = await processTurn('controller-test', stateText, 'View Cart', 'text');
      expect(outcomeText.replyText).toContain('two Alpha at ₹90 (Tax Included) each');
    });

    it('navigates to Checkout from post-add confirmation and View Cart', async () => {
      // 1. Checkout from post-add confirmation via button
      const stateButton = createInitialState();
      stateButton.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
      stateButton.messages.push({ role: 'assistant', content: 'Alpha has been added to your cart.' });
      const checkoutOutcome = await processTurn(
        'controller-test',
        stateButton,
        productActionInputFromButtonId(cartButtonId('checkout'))!,
        'text',
      );
      expect(checkoutOutcome.replyText).toBe('What is your full name?');

      // 2. Checkout from post-add confirmation via numeric reply '2'
      const stateNumber = createInitialState();
      stateNumber.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
      stateNumber.messages.push({ role: 'assistant', content: 'Alpha has been added to your cart.' });
      const checkoutNumber = await processTurn('controller-test', stateNumber, '2', 'text');
      expect(checkoutNumber.replyText).toBe('What is your full name?');

      // 3. Checkout from View Cart screen via numeric reply '2'
      const viewCartState = createInitialState();
      viewCartState.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
      viewCartState.messages.push({
        role: 'assistant',
        content: 'Your cart has two Alpha at ₹90 (Tax Included) each. The exact total is ₹180 (Tax Included).',
      });
      const checkoutFromCart = await processTurn('controller-test', viewCartState, '2', 'text');
      expect(checkoutFromCart.replyText).toBe('What is your full name?');
    });

    it('navigates to Continue Shopping and displays catalog for further product selection', async () => {
      productRepositoryMocks.listActiveProducts.mockResolvedValue([
        {
          id: 'alpha-id', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
          status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '120 caps', badge: '',
          description: 'Alpha description', highlights: [], imageUrl: 'https://cdn.example.com/alpha.png',
        },
        {
          id: 'beta-id', slug: 'beta', name: 'Beta', mrp: 200, price: 150,
          status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '60 caps', badge: '',
          description: 'Beta description', highlights: [], imageUrl: 'https://cdn.example.com/beta.png',
        },
      ]);
      const state = createInitialState();
      state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
      state.messages.push({ role: 'assistant', content: 'Alpha has been added to your cart.' });

      // 1. Via native button
      const outcomeButton = await processTurn(
        'controller-test',
        state,
        productActionInputFromButtonId(cartButtonId('continue_shopping'))!,
        'text',
      );
      expect(outcomeButton.replyText).toContain('1. Alpha — ₹90 (Tax Included) — In Stock');
      expect(outcomeButton.replyText).toContain('2. Beta — ₹150 (Tax Included) — In Stock');

      // 2. Via numeric reply '3' from post-add confirmation
      const stateNumber = createInitialState();
      stateNumber.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
      stateNumber.messages.push({ role: 'assistant', content: 'Alpha has been added to your cart.' });
      const outcomeNumber = await processTurn('controller-test', stateNumber, '3', 'text');
      expect(outcomeNumber.replyText).toContain('1. Alpha — ₹90 (Tax Included) — In Stock');
      expect(outcomeNumber.replyText).toContain('2. Beta — ₹150 (Tax Included) — In Stock');

      // 3. Via numeric reply '3' from View Cart screen
      const viewCartState = createInitialState();
      viewCartState.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 }];
      viewCartState.messages.push({
        role: 'assistant',
        content: 'Your cart has two Alpha at ₹90 (Tax Included) each. The exact total is ₹180 (Tax Included).',
      });
      const outcomeFromCart = await processTurn('controller-test', viewCartState, '3', 'text');
      expect(outcomeFromCart.replyText).toContain('1. Alpha — ₹90 (Tax Included) — In Stock');
      expect(outcomeFromCart.replyText).toContain('2. Beta — ₹150 (Tax Included) — In Stock');
    });

    it('supports multiple products in cart across Continue Shopping flow', async () => {
      productRepositoryMocks.listActiveProducts.mockResolvedValue([
        {
          id: 'alpha-id', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
          status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '120 caps', badge: '',
          description: 'Alpha description', highlights: [], imageUrl: 'https://cdn.example.com/alpha.png',
        },
        {
          id: 'beta-id', slug: 'beta', name: 'Beta', mrp: 200, price: 150,
          status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '60 caps', badge: '',
          description: 'Beta description', highlights: [], imageUrl: 'https://cdn.example.com/beta.png',
        },
      ]);
      productRepositoryMocks.getProductById.mockImplementation(async (id: string) => {
        if (id === 'beta-id') {
          return {
            id: 'beta-id', slug: 'beta', name: 'Beta', mrp: 200, price: 150,
            status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '60 caps', badge: '',
            description: 'Beta description', highlights: [], imageUrl: 'https://cdn.example.com/beta.png',
          };
        }
        return {
          id: 'alpha-id', slug: 'alpha', name: 'Alpha', mrp: 100, price: 90,
          status: 'active', stockQty: 10, stockLabel: 'In Stock', tag: '120 caps', badge: '',
          description: 'Alpha description', highlights: [], imageUrl: 'https://cdn.example.com/alpha.png',
        };
      });

      const state = createInitialState();

      // 1. Add Alpha
      const addAlpha = productActionInputFromButtonId(productButtonId('add_to_cart', 'alpha-id'))!;
      const turn1 = await processTurn('controller-test', state, addAlpha, 'text');
      const turn2 = await processTurn('controller-test', turn1.state, '2', 'text');
      expect(turn2.state.cart).toHaveLength(1);

      // 2. Continue Shopping
      const turn3 = await processTurn(
        'controller-test',
        turn2.state,
        productActionInputFromButtonId(cartButtonId('continue_shopping'))!,
        'text',
      );
      expect(turn3.replyText).toContain('2. Beta');

      // 3. Select Beta (option 2)
      const turn4 = await processTurn('controller-test', turn3.state, '2', 'text');
      expect(turn4.productCard?.name).toBe('Beta');

      // 4. Add to Cart for Beta
      const addBeta = productActionInputFromButtonId(productButtonId('add_to_cart', 'beta-id'))!;
      const turn5 = await processTurn('controller-test', turn4.state, addBeta, 'text');
      expect(turn5.replyText).toBe('How many units of Beta would you like to add to your cart?');

      // 5. Provide quantity 1 for Beta
      const turn6 = await processTurn('controller-test', turn5.state, '1', 'text');
      expect(turn6.replyText).toBe('Beta has been added to your cart.');
      expect(turn6.state.cart).toEqual([
        { productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 },
        { productId: 'beta-id', productName: 'Beta', quantity: 1, unitPrice: 150 },
      ]);

      // 6. View Cart shows both items with (Tax Included) and exact total
      const turn7 = await processTurn(
        'controller-test',
        turn6.state,
        productActionInputFromButtonId(cartButtonId('view_cart'))!,
        'text',
      );
      expect(turn7.replyText).toContain('two Alpha at ₹90 (Tax Included) each');
      expect(turn7.replyText).toContain('one Beta at ₹150 (Tax Included) each');
      expect(turn7.replyText).toContain('The exact total is ₹330 (Tax Included).');
      expect(turn7.productCard?.buttons).toEqual([
        { id: 'earthora_cart:remove_item', title: 'Remove Item' },
        { id: 'earthora_cart:checkout', title: 'Checkout' },
        { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
      ]);
    });

    it('navigates to Main Menu from empty View Cart button 2', async () => {
      const stateButton = createInitialState();
      stateButton.messages.push({
        role: 'assistant',
        content: 'Your cart is currently empty.',
      });

      const outcomeButton = await processTurn(
        'controller-test',
        stateButton,
        productActionInputFromButtonId(cartButtonId('main_menu'))!,
        'text',
      );
      expect(outcomeButton.replyText).toContain(WHATSAPP_MENU);

      const stateNumber = createInitialState();
      stateNumber.messages.push({
        role: 'assistant',
        content: 'Your cart is currently empty.',
      });
      const outcomeNumber = await processTurn('controller-test', stateNumber, '2', 'text');
      expect(outcomeNumber.replyText).toContain(WHATSAPP_MENU);
    });

    it('displays View Cart properly when cart is empty', async () => {
      const state = createInitialState();
      const outcome = await processTurn(
        'controller-test',
        state,
        productActionInputFromButtonId(cartButtonId('view_cart'))!,
        'text',
      );
      expect(outcome.replyText).toBe('Your cart is currently empty.');
      expect(outcome.productCard?.buttons).toEqual([
        { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
        { id: 'earthora_cart:main_menu', title: 'Main Menu' },
      ]);
    });

    describe('WhatsApp Checkout UX fixes: Cart Item Removal and Sequential Checkout Collection', () => {
      it('handles Remove Item flow for multi-item cart: prompts numbered list, removes selected item, updates total', async () => {
        const state = createInitialState();
        state.cart = [
          { productId: 'alpha-id', productName: 'Alpha', quantity: 2, unitPrice: 90 },
          { productId: 'beta-id', productName: 'Beta', quantity: 1, unitPrice: 150 },
        ];
        state.messages.push({
          role: 'assistant',
          content: 'Your cart has two Alpha at ₹90 (Tax Included) each and one Beta at ₹150 (Tax Included) each. The exact total is ₹330 (Tax Included).',
        });

        // 1. User clicks "Remove Item" button
        const removeTurn = await processTurn(
          'controller-test',
          state,
          productActionInputFromButtonId(cartButtonId('remove_item'))!,
          'text',
        );
        expect(removeTurn.state.awaitingCartRemoval).toBe(true);
        expect(removeTurn.replyText).toContain('Select an item to remove:');
        expect(removeTurn.replyText).toContain('1. Alpha (2 units) — ₹90 (Tax Included) each — Total ₹180 (Tax Included)');
        expect(removeTurn.replyText).toContain('2. Beta (1 unit) — ₹150 (Tax Included) each — Total ₹150 (Tax Included)');
        expect(removeTurn.replyText).toContain('Reply with the item number to remove.');

        // 2. User replies with "1" to remove Alpha
        const itemRemovedTurn = await processTurn('controller-test', removeTurn.state, '1', 'text');
        expect(itemRemovedTurn.state.awaitingCartRemoval).toBeUndefined();
        expect(itemRemovedTurn.state.cart).toEqual([
          { productId: 'beta-id', productName: 'Beta', quantity: 1, unitPrice: 150 },
        ]);
        expect(itemRemovedTurn.replyText).toContain('Alpha has been removed from your cart.');
        expect(itemRemovedTurn.replyText).toContain('Your cart has one Beta at ₹150 (Tax Included) each. The exact total is ₹150 (Tax Included).');
        expect(itemRemovedTurn.productCard?.buttons).toEqual([
          { id: 'earthora_cart:remove_item', title: 'Remove Item' },
          { id: 'earthora_cart:checkout', title: 'Checkout' },
          { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
        ]);
      });

      it('removes item via numeric reply 1 on View Cart screen', async () => {
        const state = createInitialState();
        state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
        state.messages.push({
          role: 'assistant',
          content: 'Your cart has one Alpha at ₹90 (Tax Included) each. The exact total is ₹90 (Tax Included).',
        });

        const turn1 = await processTurn('controller-test', state, '1', 'text');
        expect(turn1.state.awaitingCartRemoval).toBe(true);
        expect(turn1.replyText).toContain('Select an item to remove:');
        expect(turn1.replyText).toContain('1. Alpha (1 unit) — ₹90 (Tax Included) each — Total ₹90 (Tax Included)');
      });

      it('removes final item and gracefully transitions to empty cart with Continue Shopping and Main Menu buttons', async () => {
        const state = createInitialState();
        state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
        state.awaitingCartRemoval = true;
        state.messages.push({
          role: 'assistant',
          content: 'Select an item to remove:\n1. Alpha\nReply with the item number to remove.',
        });

        const turn = await processTurn('controller-test', state, '1', 'text');
        expect(turn.state.awaitingCartRemoval).toBeUndefined();
        expect(turn.state.cart).toEqual([]);
        expect(turn.replyText).toContain('Alpha has been removed from your cart.');
        expect(turn.replyText).toContain('Your cart is currently empty.');
        expect(turn.productCard?.buttons).toEqual([
          { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
          { id: 'earthora_cart:main_menu', title: 'Main Menu' },
        ]);
      });

      it('handles invalid item numbers safely without mutating cart or erroring', async () => {
        const state = createInitialState();
        state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
        state.awaitingCartRemoval = true;
        state.messages.push({
          role: 'assistant',
          content: 'Select an item to remove:\n1. Alpha',
        });

        const invalidTurn = await processTurn('controller-test', state, '9', 'text');
        expect(invalidTurn.state.awaitingCartRemoval).toBe(true);
        expect(invalidTurn.state.cart).toHaveLength(1);
        expect(invalidTurn.replyText).toContain('That is not a valid item number.');
        expect(invalidTurn.replyText).toContain('Select an item to remove:');
      });

      it('allows cancelling out of cart removal back to View Cart', async () => {
        const state = createInitialState();
        state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
        state.awaitingCartRemoval = true;
        state.messages.push({
          role: 'assistant',
          content: 'Select an item to remove:\n1. Alpha',
        });

        const cancelTurn = await processTurn('controller-test', state, 'cancel', 'text');
        expect(cancelTurn.state.awaitingCartRemoval).toBeUndefined();
        expect(cancelTurn.state.cart).toHaveLength(1);
        expect(cancelTurn.replyText).toContain('Your cart has one Alpha at ₹90 (Tax Included) each.');
        expect(cancelTurn.productCard?.buttons).toEqual([
          { id: 'earthora_cart:remove_item', title: 'Remove Item' },
          { id: 'earthora_cart:checkout', title: 'Checkout' },
          { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
        ]);
      });

      it('clears stale persisted checkout delivery fields on explicit Checkout and starts sequential collection', async () => {
        const state = createInitialState();
        state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
        // Stale persisted fields from previous completed order
        state.checkoutFields = {
          phone: '+919876543210',
          name: 'Old Name',
          email: 'old@example.com',
          address: 'Old Street 123',
          city: 'Old City',
          state: 'Old State',
          postalCode: '110001',
          country: 'India',
          gst: '27ABCDE1234F1Z5',
        };
        state.messages.push({
          role: 'assistant',
          content: 'Your cart has one Alpha at ₹90 (Tax Included) each. The exact total is ₹90 (Tax Included).',
        });

        // User triggers checkout
        const checkoutTurn = await processTurn(
          'controller-test',
          state,
          productActionInputFromButtonId(cartButtonId('checkout'))!,
          'text',
        );

        // Verification link must NOT be generated prematurely
        expect(checkoutTurn.outboundActions?.find((a) => a.type === 'checkout_review')).toBeUndefined();
        // Phone is preserved as authoritative WhatsApp sender phone
        expect(checkoutTurn.state.checkoutFields.phone).toBe('+919876543210');
        // Stale delivery details are cleared
        expect(checkoutTurn.state.checkoutFields.name).toBeUndefined();
        expect(checkoutTurn.state.checkoutFields.email).toBeUndefined();
        expect(checkoutTurn.state.checkoutFields.address).toBeUndefined();
        expect(checkoutTurn.state.checkoutFields.postalCode).toBeUndefined();
        expect(checkoutTurn.state.checkoutFields.gst).toBeUndefined();
        // Prompt asks for the first required missing field: Full Name
        expect(checkoutTurn.replyText).toBe('What is your full name?');
      });

      it('does not generate verification link prematurely when user enters checkout on empty cart', async () => {
        const state = createInitialState();
        state.cart = [];
        state.checkoutFields = { phone: '+919876543210' };

        const checkoutTurn = await processTurn(
          'controller-test',
          state,
          productActionInputFromButtonId(cartButtonId('checkout'))!,
          'text',
        );
        expect(checkoutTurn.replyText).toBe('Your cart is currently empty.');
        expect(checkoutTurn.outboundActions?.find((a) => a.type === 'checkout_review')).toBeUndefined();
      });

      it('advances from Name to Email when user enters name during checkout', async () => {
        const state = createInitialState();
        state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
        state.messages.push({ role: 'assistant', content: 'Alpha has been added to your cart.' });

        // Step 1: User selects Checkout
        const checkoutTurn = await processTurn(
          'controller-test',
          state,
          productActionInputFromButtonId(cartButtonId('checkout'))!,
          'text',
        );
        expect(checkoutTurn.replyText).toBe('What is your full name?');

        // Step 2: User enters name "ADARSH"
        const nameTurn = await processTurn('controller-test', checkoutTurn.state, 'ADARSH', 'text');
        expect(nameTurn.state.checkoutFields.name).toBe('ADARSH');
        expect(nameTurn.replyText).toBe('What is your email address?');
      });

      it('does not capture normal conversational messages that mention checkout keywords', async () => {
        const state = createInitialState();
        state.cart = [{ productId: 'alpha-id', productName: 'Alpha', quantity: 1, unitPrice: 90 }];
        state.messages.push({
          role: 'assistant',
          content: 'You can contact customer support with your full name and query at support@earthora.com.',
        });
        chatMock.mockResolvedValueOnce({ content: 'How else can I assist you today?', calls: [] });

        const turn = await processTurn('controller-test', state, 'Thank you', 'text');
        expect(turn.state.checkoutFields.name).toBeUndefined();
        expect(turn.replyText).toBe('How else can I assist you today?');
        expect(chatMock).toHaveBeenCalled();
      });
    });

    describe('deterministic Benefits and Dosage actions', () => {
      it('returns approved Benefits reply without invoking the LLM and retains product context', async () => {
        const state = createInitialState();
        const input = productActionInputFromButtonId(productButtonId('benefits', 'alpha-id'))!;

        const outcome = await processTurn('controller-test', state, input, 'text');

        expect(chatMock).not.toHaveBeenCalled();
        expect(outcome.replyText).toContain('Admin-approved immunity support information.');
        expect(outcome.replyText).toContain('*Benefits of Alpha:*');
        expect(outcome.state.whatsAppProductContext).toEqual({
          productId: 'alpha-id',
          productName: 'Alpha',
          awaitingQuantity: false,
          lastAction: 'benefits',
        });
      });

      it('returns approved Dosage reply without invoking the LLM and retains product context', async () => {
        knowledgeRepositoryMocks.getAllApprovedKnowledge.mockResolvedValueOnce([
          {
            id: 'knowledge-dosage-1',
            productId: 'alpha-id',
            category: 'dosage',
            question: null,
            content: 'Take 1-2 tablets daily with warm water.',
            version: 1,
            locale: 'en-IN',
          },
        ]);

        const state = createInitialState();
        const input = productActionInputFromButtonId(productButtonId('dosage', 'alpha-id'))!;

        const outcome = await processTurn('controller-test', state, input, 'text');

        expect(chatMock).not.toHaveBeenCalled();
        expect(outcome.replyText).toContain('Take 1-2 tablets daily with warm water.');
        expect(outcome.replyText).toContain('*Dosage & Directions for Alpha:*');
        expect(outcome.state.whatsAppProductContext).toEqual({
          productId: 'alpha-id',
          productName: 'Alpha',
          awaitingQuantity: false,
          lastAction: 'dosage',
        });
      });

      it('falls back safely without invoking LLM when approved knowledge entry is unavailable', async () => {
        knowledgeRepositoryMocks.getAllApprovedKnowledge.mockResolvedValueOnce([]);

        const state = createInitialState();
        const input = productActionInputFromButtonId(productButtonId('benefits', 'alpha-id'))!;

        const outcome = await processTurn('controller-test', state, input, 'text');

        expect(chatMock).not.toHaveBeenCalled();
        expect(outcome.replyText).toContain('Approved benefits information is not available for Alpha.');
        expect(outcome.state.whatsAppProductContext?.productId).toBe('alpha-id');
      });

      it('retains product context after Benefits to allow direct Add to Cart follow-up', async () => {
        const state = createInitialState();
        const benefitsInput = productActionInputFromButtonId(productButtonId('benefits', 'alpha-id'))!;
        const benefitsTurn = await processTurn('controller-test', state, benefitsInput, 'text');

        expect(chatMock).not.toHaveBeenCalled();
        expect(benefitsTurn.state.whatsAppProductContext?.productId).toBe('alpha-id');

        // Follow up with text "Add to Cart"
        const addTurn = await processTurn('controller-test', benefitsTurn.state, 'Add to Cart', 'text');
        expect(chatMock).not.toHaveBeenCalled();
        expect(addTurn.replyText).toBe('How many units of Alpha would you like to add to your cart?');
        expect(addTurn.state.whatsAppProductContext?.awaitingQuantity).toBe(true);
      });

      it('bypasses deterministic shortcut in voice mode and routes to conversational LLM', async () => {
        chatMock.mockResolvedValueOnce({ kind: 'message', content: 'In voice, Alpha provides natural wellness.' });
        const state = createInitialState();
        const input = productActionInputFromButtonId(productButtonId('benefits', 'alpha-id'))!;

        const outcome = await processTurn('controller-test', state, input, 'voice');

        expect(chatMock).toHaveBeenCalledTimes(1);
        expect(outcome.replyText).toBe('In voice, Alpha provides natural wellness.');
      });
    });
  });
});
