import { z } from 'zod';

export const createSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
});

export const sendMessageBodySchema = z.object({
  text: z.string().min(1).max(2000),
});

export const sendMessageResponseSchema = z.object({
  reply: z.string(),
});

export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;
