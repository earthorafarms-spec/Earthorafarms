import type { ToolModule } from './types.js';
import { listProductsTool, getProductDetailsTool } from './products.js';
import { getProductKnowledgeTool } from './knowledge.js';
import { getCartTool, addCartItemTool, addCartItemsTool, updateCartItemTool, removeCartItemTool } from './cart.js';
import { setCheckoutFieldTool, setDeliveryLocationTool, createVerificationLinkTool } from './checkout.js';

export const allTools: ToolModule[] = [
  listProductsTool,
  getProductDetailsTool,
  getProductKnowledgeTool,
  getCartTool,
  addCartItemTool,
  addCartItemsTool,
  updateCartItemTool,
  removeCartItemTool,
  setCheckoutFieldTool,
  setDeliveryLocationTool,
  createVerificationLinkTool,
];

export const toolsByName: Record<string, ToolModule> = Object.fromEntries(
  allTools.map((t) => [t.definition.name, t])
);
