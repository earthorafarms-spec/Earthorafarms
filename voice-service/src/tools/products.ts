import type { ToolModule } from './types.js';
import { listActiveProducts, getProductById, listActiveFestivalDeals } from '../repositories/products.repository.js';
import { applyFestivalDealDiscount } from '../domain/pricing.js';

export const listProductsTool: ToolModule = {
  definition: {
    name: 'list_products',
    description:
      "Lists Earthora Farms' currently available products. Use this to resolve a caller-spoken " +
      'product name to a product ID, or to answer "what do you sell". Never state a product as ' +
      'purchasable unless it appears in this list.',
    parameters: {
      type: 'object',
      properties: {
        // OpenAI strict mode requires every property to appear in `required`;
        // "optional" is expressed as a nullable type instead — pass null to omit.
        query: {
          type: ['string', 'null'],
          description: 'Optional free-text filter, e.g. a product name the caller mentioned. Pass null for none.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  handler: async (args) => {
    const products = await listActiveProducts();
    const deals = await listActiveFestivalDeals();
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';

    const filtered = query ? products.filter((p) => p.name.toLowerCase().includes(query)) : products;

    return {
      products: filtered.map((p) => ({
        id: p.id,
        name: p.name,
        shortDescription: p.tag || p.description.slice(0, 120),
        price: applyFestivalDealDiscount(p.price, p.id, deals),
        currency: 'INR',
        stockLabel: p.stockLabel,
      })),
    };
  },
};

export const getProductDetailsTool: ToolModule = {
  definition: {
    name: 'get_product_details',
    description:
      'Fetches live, current details (price, stock, description) for one exact product ID ' +
      'returned by list_products. Always call this before stating a specific current price or ' +
      'stock level for a specific product.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Exact product ID from list_products.' },
      },
      required: ['productId'],
      additionalProperties: false,
    },
  },
  handler: async (args) => {
    const productId = String(args.productId ?? '');
    const [product, deals] = await Promise.all([getProductById(productId), listActiveFestivalDeals()]);

    if (!product) {
      return { found: false };
    }

    return {
      found: true,
      id: product.id,
      name: product.name,
      description: product.description,
      highlights: product.highlights,
      price: applyFestivalDealDiscount(product.price, product.id, deals),
      mrp: product.mrp,
      currency: 'INR',
      stockLabel: product.stockLabel,
      inStock: product.stockLabel !== 'Out of Stock',
    };
  },
};
