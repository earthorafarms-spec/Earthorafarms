import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const srcToolsDir = path.dirname(fileURLToPath(new URL('../../src/tools/checkout.ts', import.meta.url)));

// Razorpay owns payment-link SMS/email delivery. Tool modules must not send
// notifications directly; checkout.ts is the only tool allowed to create a
// Razorpay link.
describe('payment-link delivery boundary', () => {
  const otherToolFiles = ['products.ts', 'knowledge.ts', 'cart.ts'];

  for (const file of otherToolFiles) {
    it(`${file} does not import notifications/resend`, () => {
      const contents = readFileSync(path.join(srcToolsDir, file), 'utf8');
      expect(contents).not.toMatch(/notifications\/resend/);
    });
  }

  it('checkout.ts creates the Razorpay link without importing direct notification adapters', () => {
    const contents = readFileSync(path.join(srcToolsDir, 'checkout.ts'), 'utf8');
    expect(contents).toMatch(/payments\/razorpay-links/);
    expect(contents).not.toMatch(/notifications\/resend/);
  });

  it('create_verification_link never returns the raw token or URL to the caller', () => {
    const contents = readFileSync(path.join(srcToolsDir, 'checkout.ts'), 'utf8');
    // The handler's return statements must not include verificationUrl/rawToken.
    const handlerReturn = contents.slice(contents.indexOf('createVerificationLinkTool'));
    expect(handlerReturn).not.toMatch(/return\s*\{\s*ok:\s*true,\s*(rawToken|verificationUrl)/);
  });
});
