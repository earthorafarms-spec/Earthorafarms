import { z } from 'zod';

// Server-side validation for the verification form's PATCH endpoint. This is
// the AUTHORITATIVE validation gate for the voice checkout flow (unlike the
// draft-time checks in tools/checkout.ts). Deliberately general rather than
// porting the full 10-country regex table from src/pages/checkout.tsx's
// COUNTRIES constant — flagged here as a follow-up rather than duplicating
// that table a third time; tighten per-country if false negatives show up.
export const checkoutItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(50),
});

export const patchCheckoutBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().min(6).max(20).optional(),
  address: z.string().trim().min(1).max(300).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  state: z.string().trim().min(1).max(100).optional(),
  postalCode: z.string().trim().min(3).max(15).optional(),
  country: z.string().trim().min(1).max(100).optional(),
  gst: z.string().trim().max(30).optional().nullable(),
  couponCode: z.string().trim().max(50).optional().nullable(),
  marketingConsent: z.boolean().optional(),
  items: z.array(checkoutItemSchema).max(20).optional(),
});

export const createPaymentLinkBodySchema = z.object({
  confirmed: z.literal(true),
});

export type PatchCheckoutBody = z.infer<typeof patchCheckoutBodySchema>;
