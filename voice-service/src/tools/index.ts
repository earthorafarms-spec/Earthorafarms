import type { ToolModule } from './types.js';
import { listProductsTool, getProductDetailsTool } from './products.js';
import { getProductKnowledgeTool } from './knowledge.js';
import { getCartTool, addCartItemTool, updateCartItemTool, removeCartItemTool } from './cart.js';
import { setCheckoutFieldTool, createVerificationLinkTool } from './checkout.js';

export const allTools: ToolModule[] = [
  listProductsTool,
  getProductDetailsTool,
  getProductKnowledgeTool,
  getCartTool,
  addCartItemTool,
  updateCartItemTool,
  removeCartItemTool,
  setCheckoutFieldTool,
  createVerificationLinkTool,
];

export const toolsByName: Record<string, ToolModule> = Object.fromEntries(
  allTools.map((t) => [t.definition.name, t])
);
