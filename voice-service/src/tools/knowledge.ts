import type { ToolModule } from './types.js';
import { getApprovedKnowledge, KNOWLEDGE_CATEGORIES } from '../repositories/knowledge.repository.js';

export const getProductKnowledgeTool: ToolModule = {
  definition: {
    name: 'get_product_knowledge',
    description:
      'Fetches admin-approved content for benefits, dosage, directions, ingredients, warnings, ' +
      'contraindications, storage, or FAQ for one product. This is the ONLY source you may use for ' +
      'these topics — if it returns not_found, you have no approved information and must say so; ' +
      'do not answer from your own knowledge.',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Exact product ID from list_products.' },
        category: { type: 'string', enum: [...KNOWLEDGE_CATEGORIES] },
        // OpenAI strict mode requires every property in `required`; nullable
        // type expresses "optional" — pass null if there's no short phrase.
        question: {
          type: ['string', 'null'],
          description: "The caller's question, normalized to a short phrase. Pass null if none.",
        },
      },
      required: ['productId', 'category', 'question'],
      additionalProperties: false,
    },
  },
  handler: async (args) => {
    const productId = String(args.productId ?? '');
    const category = args.category as (typeof KNOWLEDGE_CATEGORIES)[number];

    if (!KNOWLEDGE_CATEGORIES.includes(category)) {
      return { found: false, reason: 'invalid_category' };
    }

    const entries = await getApprovedKnowledge(productId, category);
    if (entries.length === 0) {
      return { found: false, reason: 'not_found' };
    }

    return {
      found: true,
      // `locale` tells the model which language this specific entry was
      // authored in, so it can prefer a same-language entry when one
      // exists, or translate faithfully from whichever is available.
      entries: entries.map((e) => ({ id: e.id, content: e.content, locale: e.locale })),
    };
  },
};
