import { describe, expect, it } from 'vitest';
import { groundedChatCompanyReply } from './chatGrounding.js';

const catalogue = { ok: true, data: [{ id: 'live-1', name: 'Morilife+ Moringa Leaf Tablets', price: 999 }] };

describe('typed chat company and farm grounding', () => {
  it('answers the exact failed compound question from the live range without inventing a farm location', () => {
    const reply = groundedChatCompanyReply('What is Earthora Farms, and where is the farm located?', catalogue, 'en');
    expect(reply).toContain('Morilife+ Moringa Leaf Tablets');
    expect(reply).toContain('cannot confirm the exact farm location');
    expect(reply).toContain('contact/warehouse address is not confirmed');
    expect(reply).not.toMatch(/powder|Gujarat|Ooty|organic|certified|single-origin/i);
  });

  it('uses a changed, multi-product live catalogue without fixed product names or counts', () => {
    const reply = groundedChatCompanyReply('Tell me about your company.', { ok: true, data: [{ name: 'New Product A' }, { name: 'New Product B' }] }, 'en');
    expect(reply).toContain('New Product A, New Product B');
    expect(reply).not.toContain('Morilife');
  });

  it('distinguishes an empty current catalogue from an unavailable lookup', () => {
    const empty = groundedChatCompanyReply('What is Earthora Farms?', { ok: true, data: [] }, 'en');
    const failed = groundedChatCompanyReply('What is Earthora Farms?', { ok: false }, 'en');
    expect(empty).toContain('No active products are listed');
    expect(failed).toContain('cannot verify');
    expect(failed).not.toContain('No active products');
  });

  it('does not interpret malformed successful data as a confirmed empty catalogue', () => {
    expect(groundedChatCompanyReply('What is Earthora Farms?', { ok: true, data: {} }, 'en')).toContain('cannot verify');
    expect(groundedChatCompanyReply('What is Earthora Farms?', { ok: true, data: [{ name: '' }] }, 'en')).toContain('cannot verify');
  });

  it.each([
    ['Where is your farm?', 'en', 'cannot confirm'],
    ['आपका फार्म कहाँ है?', 'hi', 'लोकेशन नहीं'],
    ['તમારું ફાર્મ ક્યાં છે?', 'gu', 'ચોક્કસ સ્થળ કહી શકતી નથી'],
  ])('keeps location uncertainty in the visitor language: %s', (question, language, expected) => {
    expect(groundedChatCompanyReply(question, catalogue, language)).toContain(expected);
  });

  it.each([
    'What is the price of Earthora tablets?', 'Tell me about the benefits of Earthora tablets.',
    'Tell me about the ingredients.', 'Where is your contact address?', 'Add two tablets to my cart.',
    'Can these tablets cure diabetes?',
  ])('does not bypass product or contact evidence and transaction tools: %s', question => {
    expect(groundedChatCompanyReply(question, catalogue, 'en')).toBeNull();
  });

  it('describes out-of-stock items as listed, not currently available for sale', () => {
    const reply = groundedChatCompanyReply('What is Earthora Farms?', { ok: true, data: [{ name: 'Product A', stock: 'out of stock' }] }, 'en');
    expect(reply).toContain('catalogue lists Product A');
    expect(reply).not.toContain('available');
  });
});
