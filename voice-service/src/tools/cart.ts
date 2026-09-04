import type { ToolModule, ToolContext } from './types.js';
import type { CartSnapshotLine } from '../conversation/state.js';
import { getProductById, listActiveFestivalDeals } from '../repositories/products.repository.js';
import { applyFestivalDealDiscount } from '../domain/pricing.js';

function cartSummary(cart: CartSnapshotLine[]) {
  const subtotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  return {
    items: cart.map((l) => ({
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
    subtotal,
    currency: 'INR',
    note: 'Provisional — final price/stock is re-checked when the verification form opens.',
  };
}

async function currentUnitPrice(productId: string): Promise<{ price: number; product: Awaited<ReturnType<typeof getProductById>> } | null> {
  const [product, deals] = await Promise.all([getProductById(productId), listActiveFestivalDeals()]);
  if (!product || product.status !== 'active') return null;
  return { price: applyFestivalDealDiscount(product.price, product.id, deals), product };
}

export const getCartTool: ToolModule = {
  definition: {
    name: 'get_cart',
    description: "Returns the caller's current cart contents and provisional subtotal.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  handler: async (_args, ctx: ToolContext) => cartSummary(ctx.state.cart),
};

export const addCartItemTool: ToolModule = {
  definition: {
    name: 'add_cart_item',
    description:
      'Adds a product to the cart, or increases quantity if already present. Rejects archived/' +
      'unavailable products and quantities beyond available stock — never add a product the ' +
      'backend has not confirmed as active and in stock.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Exact product ID from list_products.' },
        quantity: { type: 'integer', minimum: 1, description: 'How many units to add.' },
      },
      required: ['productId', 'quantity'],
      additionalProperties: false,
    },
  },
  handler: async (args, ctx: ToolContext) => {
    const productId = String(args.productId ?? '');
    const requestedQty = Math.max(1, Math.trunc(Number(args.quantity ?? 1)));

    const resolved = await currentUnitPrice(productId);
    if (!resolved || !resolved.product) {
      return { ok: false, reason: 'product_unavailable' };
    }
    const { price, product } = resolved;

    if (product.stockLabel === 'Out of Stock') {
      return { ok: false, reason: 'out_of_stock' };
    }

    const existing = ctx.state.cart.find((l) => l.productId === productId);
    const previousQty = existing?.quantity ?? 0;
    const nextQty = Math.min(product.stockQty, previousQty + requestedQty);

    if (existing) {
      existing.quantity = nextQty;
      existing.unitPrice = price;
    } else {
      ctx.state.cart.push({ productId, productName: product.name, quantity: nextQty, unitPrice: price });
    }

    const bounded = nextQty < previousQty + requestedQty;
    return { ok: true, boundedByStock: bounded, cart: cartSummary(ctx.state.cart) };
  },
};

export const addCartItemsTool: ToolModule = {
  definition: {
    name: 'add_cart_items',
    description:
      'Adds two or more explicitly requested products in one operation. Use this when the caller names ' +
      'multiple products and gives a quantity for each in the same utterance. Each item is checked against ' +
      'the live catalog and stock, and the result reports every line separately.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 2,
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', description: 'Exact product ID from list_products.' },
              quantity: { type: 'integer', minimum: 1, description: 'How many units to add.' },
            },
            required: ['productId', 'quantity'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  handler: async (args, ctx: ToolContext) => {
    const rawItems = Array.isArray(args.items) ? args.items.slice(0, 10) : [];
    if (rawItems.length < 2) return { ok: false, reason: 'multiple_items_required' };

    // Combine duplicate IDs first, so "two Alpha and another Alpha" becomes
    // one stock-bounded addition instead of two potentially confusing lines.
    const quantities = new Map<string, number>();
    for (const raw of rawItems) {
      const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const productId = String(item.productId ?? '');
      const quantity = Math.max(1, Math.trunc(Number(item.quantity ?? 1)));
      if (!productId) continue;
      quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
    }
    if (quantities.size < 2) return { ok: false, reason: 'multiple_products_required' };

    const results: { productId: string; requestedQuantity: number; result: unknown }[] = [];
    for (const [productId, quantity] of quantities) {
      const result = await addCartItemTool.handler({ productId, quantity }, ctx);
      results.push({ productId, requestedQuantity: quantity, result });
    }

    const allAdded = results.every(({ result }) =>
      Boolean(result && typeof result === 'object' && (result as { ok?: boolean }).ok)
    );
    return { ok: allAdded, results, cart: cartSummary(ctx.state.cart) };
  },
};

export const updateCartItemTool: ToolModule = {
  definition: {
    name: 'update_cart_item',
    description: 'Sets a product line to an exact quantity. A quantity of 0 removes it from the cart.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        quantity: { type: 'integer', minimum: 0 },
      },
      required: ['productId', 'quantity'],
      additionalProperties: false,
    },
  },
  handler: async (args, ctx: ToolContext) => {
    const productId = String(args.productId ?? '');
    const quantity = Math.max(0, Math.trunc(Number(args.quantity ?? 0)));

    if (quantity === 0) {
      ctx.state.cart = ctx.state.cart.filter((l) => l.productId !== productId);
      return { ok: true, cart: cartSummary(ctx.state.cart) };
    }

    const resolved = await currentUnitPrice(productId);
    if (!resolved || !resolved.product) {
      return { ok: false, reason: 'product_unavailable' };
    }
    const { price, product } = resolved;
    if (product.stockQty <= 0 || product.stockLabel === 'Out of Stock') {
      return { ok: false, reason: 'out_of_stock' };
    }
    const boundedQty = Math.min(quantity, product.stockQty);

    const existing = ctx.state.cart.find((l) => l.productId === productId);
    if (existing) {
      existing.quantity = boundedQty;
      existing.unitPrice = price;
    } else {
      ctx.state.cart.push({ productId, productName: product.name, quantity: boundedQty, unitPrice: price });
    }

    return { ok: true, boundedByStock: boundedQty < quantity, cart: cartSummary(ctx.state.cart) };
  },
};

export const removeCartItemTool: ToolModule = {
  definition: {
    name: 'remove_cart_item',
    description: 'Removes a product entirely from the cart.',
    parameters: {
      type: 'object',
      properties: { productId: { type: 'string' } },
      required: ['productId'],
      additionalProperties: false,
    },
  },
  handler: async (args, ctx: ToolContext) => {
    const productId = String(args.productId ?? '');
    ctx.state.cart = ctx.state.cart.filter((l) => l.productId !== productId);
    return { ok: true, cart: cartSummary(ctx.state.cart) };
  },
};
