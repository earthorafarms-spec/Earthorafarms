import { describe, it, expect } from 'vitest';
import { checkOutput, safeDeflection } from './outputPolicy.js';
import { chunkText } from '../kb/chunk.js';

describe('output policy — never claim orders/payment or ask for secrets', () => {
  it('flags an order-placed claim', () => { expect(checkOutput('Your order is placed and payment successful!').ok).toBe(false); });
  it('flags a payment-received claim', () => { expect(checkOutput('Payment received, thank you.').ok).toBe(false); });
  it('flags asking for card/OTP/CVV', () => {
    expect(checkOutput('Please share your CVV').ok).toBe(false);
    expect(checkOutput('what is the OTP you received').ok).toBe(false);
    expect(checkOutput('enter your card number').ok).toBe(false);
  });
  it('passes a normal grounded reply', () => { expect(checkOutput('Our tablets support daily energy and immunity. Would you like to add them to your cart?').ok).toBe(true); });
  it('passes a legitimate review-link reply', () => { expect(checkOutput("I've prepared your order for review — you'll pay securely on the link.").ok).toBe(true); });
  it('has localized deflections for all three languages', () => {
    for (const lang of ['en', 'hi', 'gu']) {
      expect(safeDeflection('claims-order-or-payment', lang).length).toBeGreaterThan(10);
      expect(safeDeflection('asks-sensitive', lang).length).toBeGreaterThan(10);
    }
  });
});

describe('chunking', () => {
  it('splits long text into multiple chunks with context headers', () => {
    const text = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i} about moringa benefits and daily wellness rituals for energy and immunity.`).join(' ');
    const chunks = chunkText(text, { docTitle: 'Benefits', docSummary: 'Health' });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].contextHeader).toContain('Benefits');
    expect(chunks.every((c) => c.content.length > 0)).toBe(true);
  });
  it('keeps a short doc as a single chunk', () => {
    const chunks = chunkText('Free shipping across India within 7 to 14 days.', { docTitle: 'Shipping' });
    expect(chunks.length).toBe(1);
  });
  it('preserves a markdown table as one block', () => {
    const text = '# Prices\n\n| Product | Price |\n| --- | --- |\n| Tablets | 999 |\n| Powder | 799 |';
    const chunks = chunkText(text, { docTitle: 'Prices' });
    const tableChunk = chunks.find((c) => c.content.includes('| Tablets |'));
    expect(tableChunk?.content).toContain('| Powder |');
  });
});
