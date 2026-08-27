import type { ToolModule } from './types.js';
import { listActiveProducts, getProductById, listActiveFestivalDeals } from '../repositories/products.repository.js';
import { applyFestivalDealDiscount } from '../domain/pricing.js';

const PRODUCT_QUERY_STOP_WORDS = new Set([
  'a', 'an', 'the', 'about', 'tell', 'me', 'this', 'that', 'product', 'products', 'item',
  'please', 'details', 'info', 'information', 'ke', 'ki', 'ka', 'bare', 'mein', 'batao',
  'प्रोडक्ट', 'प्रोडक्ट्स', 'उत्पाद', 'के', 'की', 'का', 'बारे', 'में', 'बताओ', 'बताइए',
]);

function normalizeProductPhrase(value: string): string {
  return (value.normalize('NFKC').toLocaleLowerCase('en-IN').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => !PRODUCT_QUERY_STOP_WORDS.has(word))
    .join(' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

export function spokenProductNameMatches(productName: string, spokenQuery: string): boolean {
  const name = normalizeProductPhrase(productName);
  const query = normalizeProductPhrase(spokenQuery);
  if (!name || !query) return false;
  if (name.includes(query) || query.includes(name)) return true;

  const queryWords = query.split(' ');
  if (queryWords.some((word) => word === name || name.includes(word) || word.includes(name))) return true;

  return editDistance(name, query) <= Math.max(1, Math.floor(Math.max(name.length, query.length) * 0.4));
}

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
    const query = typeof args.query === 'string' ? args.query.trim() : '';

    const matched = query ? products.filter((p) => spokenProductNameMatches(p.name, query)) : products;
    // A speech-recognition spelling such as "Alfa", or extra words such as
    // "Alpha product ke bare mein", must not turn a valid catalog into an
    // empty result. Return the full live catalog as a safe recovery surface;
    // the model can select the closest name or ask one concise confirmation.
    const filtered = query && matched.length === 0 ? products : matched;

    return {
      queryMatched: !query || matched.length > 0,
      usedFullCatalogFallback: Boolean(query && matched.length === 0),
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
