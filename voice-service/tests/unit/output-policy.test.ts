import { describe, it, expect, beforeEach } from 'vitest';
import { enforceOutputPolicy, resetGuardState } from '../../src/conversation/output-policy.js';
import type { TurnToolFact } from '../../src/conversation/state.js';

describe('enforceOutputPolicy', () => {
  beforeEach(() => {
    resetGuardState('test-session');
  });

  it('allows a price that WAS returned by a tool this turn', () => {
    const facts: TurnToolFact[] = [
      { toolName: 'get_product_details', resultJson: JSON.stringify({ name: 'Moringa Powder', price: 799 }) },
    ];
    const result = enforceOutputPolicy('That will be ₹799 today.', facts, 'test-session');
    expect(result.action).toBe('pass');
    expect(result.text).toContain('₹799');
    expect(result.violations).toHaveLength(0);
  });

  it('blocks an unearned "order placed" claim regardless of tool facts (immediate mask, not regenerate)', () => {
    const result = enforceOutputPolicy('Great news, your order is placed!', [], 'test-session');
    expect(result.action).toBe('pass');
    expect(result.text.toLowerCase()).not.toContain('order is placed');
    expect(result.violations.some((v) => v.includes('order-placed'))).toBe(true);
  });

  it('blocks a request for payment credentials (immediate mask, not regenerate)', () => {
    const result = enforceOutputPolicy('Can you tell me the CVV on your card?', [], 'test-session');
    expect(result.action).toBe('pass');
    expect(result.text.toLowerCase()).not.toContain('cvv');
    expect(result.violations.some((v) => v.includes('payment credential'))).toBe(true);
  });

  it('allows a stock claim when a tool was actually called this turn', () => {
    const facts: TurnToolFact[] = [
      { toolName: 'get_product_details', resultJson: JSON.stringify({ stockLabel: 'In Stock' }) },
    ];
    const result = enforceOutputPolicy('Yes, that is in stock.', facts, 'test-session');
    expect(result.action).toBe('pass');
    expect(result.violations).toHaveLength(0);
  });

  describe('two-strike regenerate-then-fallback for attribution violations', () => {
    it('first unattributed price claim in a session returns action:"regenerate" with a corrective instruction', () => {
      const result = enforceOutputPolicy('That will be ₹5000 today.', [], 'test-session');
      expect(result.action).toBe('regenerate');
      expect(result.instruction).toBeTruthy();
      expect(result.violations.some((v) => v.includes('unattributed price claim'))).toBe(true);
    });

    it('a SECOND consecutive unattributed price claim in the same session falls back to a safe line', () => {
      enforceOutputPolicy('That will be ₹5000 today.', [], 'test-session'); // strike 1
      const second = enforceOutputPolicy('It costs ₹6000.', [], 'test-session'); // strike 2
      expect(second.action).toBe('fallback');
      expect(second.text).not.toContain('₹6000');
    });

    it('a clean turn in between resets the strike counter', () => {
      enforceOutputPolicy('That will be ₹5000 today.', [], 'test-session'); // strike 1
      const facts: TurnToolFact[] = [{ toolName: 'get_product_details', resultJson: JSON.stringify({ price: 799 }) }];
      const clean = enforceOutputPolicy('It is ₹799.', facts, 'test-session'); // pass — resets counter
      expect(clean.action).toBe('pass');

      const next = enforceOutputPolicy('That will be ₹5000 today.', [], 'test-session'); // strike 1 again, not strike 2
      expect(next.action).toBe('regenerate');
    });

    it('flags a positive stock claim made with zero tool calls this turn', () => {
      const result = enforceOutputPolicy('Yes, that is in stock.', [], 'test-session');
      expect(result.action).toBe('regenerate');
      expect(result.violations.some((v) => v.includes('availability claim'))).toBe(true);
    });

    it('flags a NEGATIVE/fabricated absence claim made with zero tool calls this turn (real bug found in testing)', () => {
      // GPT-4o mini once invented "we don't sell herbal tea"; Sarvam once
      // claimed zero products exist when one does. Both are exactly as
      // dangerous as inventing a price, and neither used to be caught.
      const result = enforceOutputPolicy("We currently don't have any products available.", [], 'test-session');
      expect(result.action).toBe('regenerate');
      expect(result.violations.some((v) => v.includes('availability claim'))).toBe(true);
    });

    it('flags a fabricated Hindi absence claim made with zero tool calls this turn', () => {
      const result = enforceOutputPolicy('अभी हमारे पास कोई प्रोडक्ट उपलब्ध नहीं है।', [], 'test-session');
      expect(result.action).toBe('regenerate');
      expect(result.violations.some((v) => v.includes('availability claim'))).toBe(true);
    });

    it('allows a negative availability claim when a tool WAS actually called this turn', () => {
      const facts: TurnToolFact[] = [{ toolName: 'list_products', resultJson: JSON.stringify({ products: [] }) }];
      const result = enforceOutputPolicy("We don't have any products available right now.", facts, 'test-session');
      expect(result.action).toBe('pass');
    });

    it('strike counters are isolated per session', () => {
      enforceOutputPolicy('₹5000 for that.', [], 'session-a'); // strike 1 for session-a only
      const sessionB = enforceOutputPolicy('₹5000 for that.', [], 'session-b');
      expect(sessionB.action).toBe('regenerate'); // session-b's own strike 1, not session-a's strike 2
    });
  });
});
