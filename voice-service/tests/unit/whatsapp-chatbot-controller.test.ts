import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processWhatsAppTurn,
  getWhatsAppActiveSubFlow,
  buildWhatsAppTimeoutReply,
  resetWhatsAppTimeoutState,
  buildProductKnowledgeCard,
  buildProductKnowledgeReply,
  buildWhatsAppProductCard,
  buildPostAddToCartCard,
  buildViewCartCard,
  buildWhatsAppMenuReply,
  shouldShowWhatsAppMenu,
  nextWhatsAppCheckoutQuestion,
  isProductMenuSelection,
  PRODUCT_MENU_SELECTION_PATTERN,
  isBenefitsMenuSelection,
  BENEFITS_MENU_SELECTION_PATTERN,
  buildGeneralMoringaBenefitsReply,
} from '../../../whatsapp-chatbot/conversation/controller.js';
import { createInitialState } from '../../src/conversation/state.js';
import { WHATSAPP_MENU, WHATSAPP_POLICIES_MENU } from '../../../whatsapp-chatbot/prompt.js';
import { productButtonId, cartButtonId, productActionInputFromButtonId } from '../../../whatsapp-chatbot/product-card.js';

vi.mock('../../src/tools/index.js', () => {
  return {
    allTools: [],
    toolsByName: {
      list_products: {
        definition: { name: 'list_products', description: '', parameters: {} },
        handler: vi.fn().mockResolvedValue({
          products: [
            { id: 'alpha-id', name: 'Alpha Herb', price: 250, currency: 'INR', stockLabel: 'In Stock' },
            { id: 'beta-id', name: 'Beta Tonic', price: 400, currency: 'INR', stockLabel: 'In Stock' },
          ],
        }),
      },
      add_cart_item: {
        definition: { name: 'add_cart_item', description: '', parameters: {} },
        handler: vi.fn().mockImplementation(async ({ productId, quantity }, ctx) => {
          ctx.state.cart.push({
            productId,
            productName: productId === 'alpha-id' ? 'Alpha Herb' : 'Beta Tonic',
            unitPrice: productId === 'alpha-id' ? 250 : 400,
            quantity,
          });
          return { ok: true, cart: ctx.state.cart };
        }),
      },
      get_product_details: {
        definition: { name: 'get_product_details', description: '', parameters: {} },
        handler: vi.fn().mockImplementation(async ({ productId }: { productId: string }) => {
          if (productId === 'alpha-id') {
            return {
              found: true,
              id: 'alpha-id',
              name: 'Alpha Herb',
              price: 250,
              mrp: 300,
              currency: 'INR',
              stockLabel: 'In Stock',
              description: 'Pure organic herbal formula.',
              imageUrl: 'https://example.com/alpha.png',
            };
          }
          return {
            found: true,
            id: 'beta-id',
            name: 'Beta Tonic',
            price: 400,
            currency: 'INR',
            stockLabel: 'In Stock',
            description: 'Revitalizing daily tonic.',
          };
        }),
      },
      get_cart: {
        definition: { name: 'get_cart', description: '', parameters: {} },
        handler: vi.fn().mockImplementation(async (_args, ctx) => ({ items: ctx.state.cart })),
      },
      set_checkout_field: {
        definition: { name: 'set_checkout_field', description: '', parameters: {} },
        handler: vi.fn().mockImplementation(async ({ field, value }, ctx) => {
          ctx.state.checkoutFields[field] = value;
          return { ok: true, field, value };
        }),
      },
      set_delivery_location: {
        definition: { name: 'set_delivery_location', description: '', parameters: {} },
        handler: vi.fn().mockImplementation(async ({ city, state }, ctx) => {
          ctx.state.checkoutFields.city = city;
          ctx.state.checkoutFields.state = state;
          return { ok: true, city, state };
        }),
      },
      create_verification_link: {
        definition: { name: 'create_verification_link', description: '', parameters: {} },
        handler: vi.fn().mockImplementation(async (_args, ctx) => {
          ctx.outboundActions.push({ type: 'checkout_review', url: 'https://example.com/review/token123' });
          return { ok: true };
        }),
      },
    },
  };
});

vi.mock('../../src/tools/knowledge.js', () => ({
  getAllApprovedProductKnowledge: vi.fn().mockImplementation(async (productId: string) => {
    if (productId === 'alpha-id') {
      return {
        found: true,
        entries: [
          {
            id: 'k1',
            productId: 'alpha-id',
            category: 'benefits',
            content: 'Boosts natural immunity and stamina.',
          },
          {
            id: 'k2',
            productId: 'alpha-id',
            category: 'dosage',
            content: 'Take 1 capsule twice daily with warm water.',
          },
        ],
      };
    }
    return { found: false, entries: [] };
  }),
}));

describe('WhatsApp-owned Conversation Controller (whatsapp-chatbot/conversation/controller.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Menu and Greetings', () => {
    it('returns main menu for common greeting', async () => {
      const state = createInitialState();
      const outcome = await processWhatsAppTurn('session-1', state, 'Hello');
      expect(outcome.replyText).toContain(WHATSAPP_MENU);
      expect(outcome.replyText).toContain('Hello! How can I assist you today?');
      expect(outcome.productCard).toBeUndefined();
    });

    it('returns main menu when explicit menu is requested', async () => {
      const state = createInitialState();
      const outcome = await processWhatsAppTurn('session-1', state, 'Menu');
      expect(outcome.replyText).toContain(WHATSAPP_MENU);
    });

    it('returns policies menu when 3 is selected from main menu', async () => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: buildWhatsAppMenuReply('en') });
      const outcome = await processWhatsAppTurn('session-1', state, '3');
      expect(outcome.replyText).toBe(WHATSAPP_POLICIES_MENU);
    });
  });

  describe('Product Catalog & Cards', () => {
    it('returns product cards when 1 is selected from main menu', async () => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: buildWhatsAppMenuReply('en') });
      const outcome = await processWhatsAppTurn('session-1', state, '1');
      expect(outcome.productCards).toBeDefined();
      expect(outcome.productCards!.length).toBe(2);
      expect(outcome.productCards![0].name).toBe('Alpha Herb');
      expect(outcome.productCards![0].imageUrl).toBe('https://example.com/alpha.png');
      expect(outcome.productCards![1].name).toBe('Beta Tonic');
    });

    it.each([
      ['Products'],
      ['products'],
      ['Product'],
      ['1 -> Products'],
      ['1. Products'],
      ['1 → Products'],
      ['1 - Products'],
      ['1.Products'],
      ['પ્રોડક્ટ્સ'],
      ['પ્રોડક્ટ'],
      ['प्रोडक्ट्स'],
      ['प्रोडक्ट'],
      ['उत्पाद'],
      ['1 -> પ્રોડક્ટ'],
      ['1. उत्पाद'],
    ])('returns product cards for menu alias %s when main menu was shown', async (alias) => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: buildWhatsAppMenuReply('en') });
      const outcome = await processWhatsAppTurn('session-1', state, alias);
      expect(outcome.productCards).toBeDefined();
      expect(outcome.productCards!.length).toBe(2);
      expect(outcome.productCards![0].name).toBe('Alpha Herb');
      expect(outcome.productCards![0].imageUrl).toBe('https://example.com/alpha.png');
      expect(outcome.productCards![1].name).toBe('Beta Tonic');
      expect(outcome.replyText).not.toContain('Would you like to hear about it or order it?');
    });

    it('does NOT return product cards for "Products" outside main menu context', async () => {
      const state = createInitialState();
      // No preceding menu in history
      const outcome = await processWhatsAppTurn('session-1', state, 'Products');
      expect(outcome.productCards).toBeUndefined();
    });

    it('does NOT hijack quantity input when awaiting quantity', async () => {
      const state = createInitialState();
      state.whatsAppProductContext = {
        productId: 'alpha-id',
        productName: 'Alpha Herb',
        awaitingQuantity: true,
      };

      // User sends "1" for quantity (1 unit)
      const outcomeOne = await processWhatsAppTurn('session-1', state, '1');
      expect(outcomeOne.productCards).toBeUndefined();
      expect(outcomeOne.state.cart.length).toBe(1);
      expect(outcomeOne.state.cart[0].productId).toBe('alpha-id');
      expect(outcomeOne.state.cart[0].quantity).toBe(1);

      // Reset awaitingQuantity state
      const state2 = createInitialState();
      state2.whatsAppProductContext = {
        productId: 'alpha-id',
        productName: 'Alpha Herb',
        awaitingQuantity: true,
      };
      const outcomeProducts = await processWhatsAppTurn('session-1', state2, 'Products');
      expect(outcomeProducts.productCards).toBeUndefined();
    });

    it('does NOT hijack cart removal when awaiting cart removal', async () => {
      const state = createInitialState();
      state.cart = [
        { productId: 'alpha-id', productName: 'Alpha Herb', unitPrice: 250, quantity: 1 },
        { productId: 'beta-id', productName: 'Beta Tonic', unitPrice: 400, quantity: 1 },
      ];
      state.awaitingCartRemoval = true;

      // User sends "1" to remove item 1
      const outcome = await processWhatsAppTurn('session-1', state, '1');
      expect(outcome.productCards).toBeUndefined();
      expect(outcome.state.cart.length).toBe(1);
      expect(outcome.state.cart[0].productId).toBe('beta-id');
    });

    it('does NOT treat "1" as product selection in policies menu', async () => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: WHATSAPP_POLICIES_MENU });
      const outcome = await processWhatsAppTurn('session-1', state, '1');
      expect(outcome.productCards).toBeUndefined();
      expect(outcome.replyText).toContain('Shipping & Delivery');
    });

    it('validates isProductMenuSelection helper directly across various formats and states', () => {
      const menuMessages = [{ role: 'assistant' as const, content: buildWhatsAppMenuReply('en') }];
      const noMenuMessages = [{ role: 'assistant' as const, content: 'Hello! How can I help you?' }];

      expect(isProductMenuSelection('1', menuMessages)).toBe(true);
      expect(isProductMenuSelection('Products', menuMessages)).toBe(true);
      expect(isProductMenuSelection('products', menuMessages)).toBe(true);
      expect(isProductMenuSelection('Product', menuMessages)).toBe(true);
      expect(isProductMenuSelection('1 -> Products', menuMessages)).toBe(true);
      expect(isProductMenuSelection('1. Products', menuMessages)).toBe(true);
      expect(isProductMenuSelection('1 → Products', menuMessages)).toBe(true);

      // Fails when menu was not shown
      expect(isProductMenuSelection('1', noMenuMessages)).toBe(false);
      expect(isProductMenuSelection('Products', noMenuMessages)).toBe(false);

      // Fails when awaiting quantity
      const stateQuantity = createInitialState();
      stateQuantity.whatsAppProductContext = { productId: 'p1', productName: 'P1', awaitingQuantity: true };
      expect(isProductMenuSelection('1', menuMessages, stateQuantity)).toBe(false);
      expect(isProductMenuSelection('Products', menuMessages, stateQuantity)).toBe(false);

      // Fails when awaiting cart removal
      const stateRemoval = createInitialState();
      stateRemoval.awaitingCartRemoval = true;
      expect(isProductMenuSelection('1', menuMessages, stateRemoval)).toBe(false);
      expect(isProductMenuSelection('Products', menuMessages, stateRemoval)).toBe(false);

      // Fails on non-matching inputs
      expect(isProductMenuSelection('2', menuMessages)).toBe(false);
      expect(isProductMenuSelection('Tell me about your products', menuMessages)).toBe(false);
    });
  });

  describe('Top-Level Benefits Menu UX (Option 2)', () => {
    it('returns educational Moringa text and all product cards when 2 is selected from main menu', async () => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: buildWhatsAppMenuReply('en') });
      const outcome = await processWhatsAppTurn('session-1', state, '2');

      expect(outcome.productCards).toBeDefined();
      expect(outcome.productCards!.length).toBe(2);
      expect(outcome.productCards![0].name).toBe('Alpha Herb');
      expect(outcome.productCards![1].name).toBe('Beta Tonic');
      expect(outcome.replyText).toContain('*Benefits of Moringa:*');
      expect(outcome.replyText).toContain('nutrient-dense superfood');
      expect(outcome.replyText).toContain('vitamins A, C, and E');
      expect(outcome.replyText).toContain('immunity');
      expect(outcome.replyText).not.toContain('Would you like to hear about it or order it?');
    });

    it.each([
      ['Benefits'],
      ['benefits'],
      ['2 -> Benefits'],
      ['2. Benefits'],
      ['2 → Benefits'],
      ['2 - Benefits'],
      ['2.Benefits'],
      ['2 Benefits'],
      ['फायदे'],
      ['लाभ'],
      ['ફાયદા'],
    ])('returns educational text and all product cards for alias %s', async (alias) => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: buildWhatsAppMenuReply('en') });
      const outcome = await processWhatsAppTurn('session-1', state, alias);

      expect(outcome.productCards).toBeDefined();
      expect(outcome.productCards!.length).toBe(2);
      expect(outcome.productCards![0].name).toBe('Alpha Herb');
      expect(outcome.productCards![1].name).toBe('Beta Tonic');
      expect(outcome.replyText).not.toContain('Would you like to hear about it or order it?');
    });

    it('returns localized educational Moringa text in Hindi and Gujarati', async () => {
      const hiState = createInitialState();
      hiState.currentLanguage = 'hi';
      hiState.messages.push({ role: 'assistant', content: buildWhatsAppMenuReply('hi') });
      const hiOutcome = await processWhatsAppTurn('session-1', hiState, '2');
      expect(hiOutcome.productCards).toBeDefined();
      expect(hiOutcome.replyText).toContain('*सहजन / मोरिंगा के फायदे:*');
      expect(hiOutcome.replyText).toContain('विटामिन A, C, E');

      const guState = createInitialState();
      guState.currentLanguage = 'gu';
      guState.messages.push({ role: 'assistant', content: buildWhatsAppMenuReply('gu') });
      const guOutcome = await processWhatsAppTurn('session-1', guState, '2');
      expect(guOutcome.productCards).toBeDefined();
      expect(guOutcome.replyText).toContain('*સરગવો / મોરિંગા ના ફાયદા:*');
      expect(guOutcome.replyText).toContain('વિટામિન A, C, E');
    });

    it('does NOT trigger top-level Benefits flow outside main menu context', () => {
      const state = createInitialState();
      // No menu in message history
      expect(isBenefitsMenuSelection('2', state.messages, state)).toBe(false);
      expect(isBenefitsMenuSelection('Benefits', state.messages, state)).toBe(false);
      expect(isBenefitsMenuSelection('2 -> Benefits', state.messages, state)).toBe(false);
    });

    it('does NOT hijack quantity input when awaiting quantity (e.g. user orders 2 units)', async () => {
      const state = createInitialState();
      state.whatsAppProductContext = {
        productId: 'alpha-id',
        productName: 'Alpha Herb',
        awaitingQuantity: true,
      };

      const outcome = await processWhatsAppTurn('session-1', state, '2');
      expect(outcome.productCards).toBeUndefined();
      expect(outcome.state.cart.length).toBe(1);
      expect(outcome.state.cart[0].productId).toBe('alpha-id');
      expect(outcome.state.cart[0].quantity).toBe(2);
      expect(outcome.replyText).toContain('Alpha Herb has been added to your cart.');
    });

    it('does NOT hijack cart removal when awaiting cart removal (e.g. user removes item 2)', async () => {
      const state = createInitialState();
      state.cart = [
        { productId: 'alpha-id', productName: 'Alpha Herb', unitPrice: 250, quantity: 1 },
        { productId: 'beta-id', productName: 'Beta Tonic', unitPrice: 400, quantity: 1 },
      ];
      state.awaitingCartRemoval = true;

      const outcome = await processWhatsAppTurn('session-1', state, '2');
      expect(outcome.productCards).toBeUndefined();
      expect(outcome.state.cart.length).toBe(1);
      expect(outcome.state.cart[0].productId).toBe('alpha-id');
    });

    it('does NOT treat "2" as Benefits in policies menu (displays Return Policy)', async () => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: WHATSAPP_POLICIES_MENU });
      const outcome = await processWhatsAppTurn('session-1', state, '2');
      expect(outcome.productCards).toBeUndefined();
      expect(outcome.replyText).toContain('Returns & Order Cancellation');
    });

    it('does NOT hijack checkout answers containing "2" (e.g. address with Flat 2B)', async () => {
      const state = createInitialState();
      state.cart = [{ productId: 'alpha-id', productName: 'Alpha Herb', unitPrice: 250, quantity: 1 }];
      state.checkoutFields = { name: 'Adarsh Patel', email: 'adarsh@example.com', phone: '9876543210' };
      state.messages.push({ role: 'assistant', content: 'What is your street address?' });

      const outcome = await processWhatsAppTurn('session-1', state, 'Flat 2, Block B');
      expect(outcome.productCards).toBeUndefined();
      expect(outcome.state.checkoutFields.address).toBe('Flat 2, Block B');
      expect(outcome.replyText).toContain('Please tell me your city and state.');
    });

    it('preserves typed "Benefits" behavior when product context is active', async () => {
      const state = createInitialState();
      state.whatsAppProductContext = {
        productId: 'alpha-id',
        productName: 'Alpha Herb',
        awaitingQuantity: false,
      };

      const outcome = await processWhatsAppTurn('session-1', state, 'Benefits');
      expect(outcome.productCards).toBeUndefined();
      expect(outcome.productCard).toBeDefined();
      expect(outcome.productCard?.productId).toBe('alpha-id');
      expect(outcome.replyText).toContain('*Benefits of Alpha Herb:*');
      expect(outcome.replyText).toContain('Boosts natural immunity and stamina.');
      expect(outcome.productCard?.buttons).toEqual([
        { id: productButtonId('add_to_cart', 'alpha-id'), title: 'Add to Cart' },
        { id: cartButtonId('main_menu'), title: 'Menu' },
      ]);
    });

    it('preserves Products flow ("1") unchanged without educational Moringa header', async () => {
      const state = createInitialState();
      state.messages.push({ role: 'assistant', content: buildWhatsAppMenuReply('en') });
      const outcome = await processWhatsAppTurn('session-1', state, '1');

      expect(outcome.productCards).toBeDefined();
      expect(outcome.productCards!.length).toBe(2);
      expect(outcome.replyText).not.toContain('*Benefits of Moringa:*');
      // For Products flow, replyText is joined card bodies
      expect(outcome.replyText).toContain('Alpha Herb');
      expect(outcome.replyText).toContain('Beta Tonic');
    });

    it('validates isBenefitsMenuSelection helper directly across various formats and safety guards', () => {
      const menuMessages = [{ role: 'assistant' as const, content: buildWhatsAppMenuReply('en') }];
      const noMenuMessages = [{ role: 'assistant' as const, content: 'Hello! How can I help you?' }];
      const policiesMessages = [{ role: 'assistant' as const, content: WHATSAPP_POLICIES_MENU }];

      expect(isBenefitsMenuSelection('2', menuMessages)).toBe(true);
      expect(isBenefitsMenuSelection('Benefits', menuMessages)).toBe(true);
      expect(isBenefitsMenuSelection('benefits', menuMessages)).toBe(true);
      expect(isBenefitsMenuSelection('2 -> Benefits', menuMessages)).toBe(true);
      expect(isBenefitsMenuSelection('2. Benefits', menuMessages)).toBe(true);
      expect(isBenefitsMenuSelection('2 → Benefits', menuMessages)).toBe(true);
      expect(isBenefitsMenuSelection('ફાયદા', menuMessages)).toBe(true);
      expect(isBenefitsMenuSelection('फायदे', menuMessages)).toBe(true);
      expect(isBenefitsMenuSelection('लाभ', menuMessages)).toBe(true);

      // Fails outside menu
      expect(isBenefitsMenuSelection('2', noMenuMessages)).toBe(false);
      expect(isBenefitsMenuSelection('Benefits', noMenuMessages)).toBe(false);

      // Fails in policies menu
      expect(isBenefitsMenuSelection('2', policiesMessages)).toBe(false);

      // Fails when awaiting quantity
      const stateQty = createInitialState();
      stateQty.whatsAppProductContext = { productId: 'p1', productName: 'P1', awaitingQuantity: true };
      expect(isBenefitsMenuSelection('2', menuMessages, stateQty)).toBe(false);

      // Fails when awaiting cart removal
      const stateRemoval = createInitialState();
      stateRemoval.awaitingCartRemoval = true;
      expect(isBenefitsMenuSelection('2', menuMessages, stateRemoval)).toBe(false);

      // Fails on non-matching inputs
      expect(isBenefitsMenuSelection('1', menuMessages)).toBe(false);
      expect(isBenefitsMenuSelection('3', menuMessages)).toBe(false);
    });
  });

  describe('Benefits and Dosage UX', () => {
    it('generates native 2-button card for Benefits without instructional text', async () => {
      const state = createInitialState();
      const input = productActionInputFromButtonId(productButtonId('benefits', 'alpha-id'))!;
      const outcome = await processWhatsAppTurn('session-1', state, input);

      expect(outcome.replyText).toContain('*Benefits of Alpha Herb:*');
      expect(outcome.replyText).toContain('Boosts natural immunity and stamina.');
      expect(outcome.replyText).not.toContain('To add to cart, type "Add to Cart"');
      expect(outcome.replyText).not.toContain('To return to the main menu, type Menu');

      expect(outcome.productCard).toBeDefined();
      expect(outcome.productCard!.buttons).toEqual([
        { id: productButtonId('add_to_cart', 'alpha-id'), title: 'Add to Cart' },
        { id: cartButtonId('main_menu'), title: 'Menu' },
      ]);
    });

    it('generates native 2-button card for Dosage without instructional text', async () => {
      const state = createInitialState();
      const input = productActionInputFromButtonId(productButtonId('dosage', 'alpha-id'))!;
      const outcome = await processWhatsAppTurn('session-1', state, input);

      expect(outcome.replyText).toContain('*Dosage & Directions for Alpha Herb:*');
      expect(outcome.replyText).toContain('Take 1 capsule twice daily with warm water.');
      expect(outcome.replyText).not.toContain('To add to cart, type "Add to Cart"');

      expect(outcome.productCard).toBeDefined();
      expect(outcome.productCard!.buttons).toEqual([
        { id: productButtonId('add_to_cart', 'alpha-id'), title: 'Add to Cart' },
        { id: cartButtonId('main_menu'), title: 'Menu' },
      ]);
    });

    it('allows typing "add to cart" after viewing Benefits and sets awaitingQuantity', async () => {
      const state = createInitialState();
      const benefitsInput = productActionInputFromButtonId(productButtonId('benefits', 'alpha-id'))!;
      const benefitsTurn = await processWhatsAppTurn('session-1', state, benefitsInput);

      const addTurn = await processWhatsAppTurn('session-1', benefitsTurn.state, 'add to cart');
      expect(addTurn.replyText).toContain('How many units of Alpha Herb would you like to add to your cart?');
      expect(addTurn.state.whatsAppProductContext?.awaitingQuantity).toBe(true);
      expect(addTurn.state.whatsAppProductContext?.productId).toBe('alpha-id');
    });

    it('allows typing "Menu" after viewing Benefits and returns to main menu', async () => {
      const state = createInitialState();
      const benefitsInput = productActionInputFromButtonId(productButtonId('benefits', 'alpha-id'))!;
      const benefitsTurn = await processWhatsAppTurn('session-1', state, benefitsInput);

      const menuTurn = await processWhatsAppTurn('session-1', benefitsTurn.state, 'Menu');
      expect(menuTurn.replyText).toContain(WHATSAPP_MENU);
      expect(menuTurn.state.whatsAppProductContext).toBeUndefined();
    });
  });

  describe('Add to Cart, Quantity and View Cart', () => {
    it('adds product to cart when quantity is provided', async () => {
      const state = createInitialState();
      state.whatsAppProductContext = {
        productId: 'alpha-id',
        productName: 'Alpha Herb',
        awaitingQuantity: true,
      };

      const outcome = await processWhatsAppTurn('session-1', state, '2');
      expect(outcome.state.cart.length).toBe(1);
      expect(outcome.state.cart[0].productId).toBe('alpha-id');
      expect(outcome.state.cart[0].quantity).toBe(2);
      expect(outcome.replyText).toContain('Alpha Herb has been added to your cart.');
      expect(outcome.productCard?.buttons).toEqual([
        { id: 'earthora_cart:view_cart', title: 'View Cart' },
        { id: 'earthora_cart:checkout', title: 'Checkout' },
        { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
      ]);
    });

    it('views cart with correct buttons', async () => {
      const state = createInitialState();
      state.cart = [
        {
          productId: 'alpha-id',
          productName: 'Alpha Herb',
          unitPrice: 250,
          quantity: 2,
        },
      ];
      const card = buildViewCartCard(state);
      expect(card.body).toContain('Alpha Herb');
      expect(card.body).toContain('two Alpha Herb');
      expect(card.buttons).toEqual([
        { id: 'earthora_cart:remove_item', title: 'Remove Item' },
        { id: 'earthora_cart:checkout', title: 'Checkout' },
        { id: 'earthora_cart:continue_shopping', title: 'Continue Shopping' },
      ]);
    });
  });

  describe('Checkout and GST flow', () => {
    it('steps through checkout questions sequentially', async () => {
      const state = createInitialState();
      state.cart = [{ productId: 'alpha-id', productName: 'Alpha Herb', unitPrice: 250, quantity: 1 }];

      // Start checkout
      const turn1 = await processWhatsAppTurn('session-1', state, 'Checkout');
      expect(turn1.replyText).toContain('What is your full name?');

      // Answer name
      const turn2 = await processWhatsAppTurn('session-1', turn1.state, 'Adarsh Patel');
      expect(turn2.replyText).toContain('What is your email address?');

      // Answer email
      const turn3 = await processWhatsAppTurn('session-1', turn2.state, 'adarsh@example.com');
      expect(turn3.replyText).toContain('What WhatsApp number should I use?');

      // Answer phone
      const turn4 = await processWhatsAppTurn('session-1', turn3.state, '9876543210');
      expect(turn4.replyText).toContain('What is your street address?');

      // Answer street address
      const turn5 = await processWhatsAppTurn('session-1', turn4.state, '12 Garden Road');
      expect(turn5.replyText).toContain('Please tell me your city and state.');

      // Answer city and state
      const turn6 = await processWhatsAppTurn('session-1', turn5.state, 'Ahmedabad, Gujarat');
      expect(turn6.replyText).toContain('What is your six-digit PIN code?');

      // Answer postal code
      const turn7 = await processWhatsAppTurn('session-1', turn6.state, '380001');
      expect(turn7.replyText).toContain('Is the delivery address in India?');

      // Answer India
      const turn8 = await processWhatsAppTurn('session-1', turn7.state, 'Yes');
      expect(turn8.replyText).toContain('Do you have a GST number for a business tax invoice?');

      // Answer No to GST -> triggers verification link
      const turn9 = await processWhatsAppTurn('session-1', turn8.state, 'No');
      expect(turn9.replyText).toContain('https://example.com/review/token123');
      expect(turn9.outboundActions?.some((a) => a.type === 'checkout_review')).toBe(true);
    });
  });

  describe('Inactivity timeout and subflows', () => {
    it('detects quantity subflow', () => {
      const state = createInitialState();
      state.whatsAppProductContext = {
        productId: 'alpha-id',
        productName: 'Alpha Herb',
        awaitingQuantity: true,
      };
      expect(getWhatsAppActiveSubFlow(state)).toBe('quantity');
    });

    it('detects checkout subflow when checkout question is active', () => {
      const state = createInitialState();
      state.cart = [{ productId: 'alpha-id', productName: 'Alpha Herb', unitPrice: 250, quantity: 1 }];
      expect(getWhatsAppActiveSubFlow(state, 'What is your full name?')).toBe('checkout');
    });

    it('detects cart removal subflow', () => {
      const state = createInitialState();
      state.awaitingCartRemoval = true;
      expect(getWhatsAppActiveSubFlow(state)).toBe('cart_removal');
    });

    it('builds timeout reply and resets timeout state', () => {
      const reply = buildWhatsAppTimeoutReply('en');
      expect(reply).toContain("It looks like you've been away for a while.");
      expect(reply).toContain(WHATSAPP_MENU);

      const state = createInitialState();
      state.whatsAppProductContext = { productId: 'alpha-id', productName: 'Alpha', awaitingQuantity: true };
      state.awaitingCartRemoval = true;
      state.checkoutFields = { name: 'Test' };

      const reset = resetWhatsAppTimeoutState(state);
      expect(reset.whatsAppProductContext).toBeUndefined();
      expect(reset.awaitingCartRemoval).toBeUndefined();
      expect(reset.checkoutFields).toEqual({});
    });
  });
});
