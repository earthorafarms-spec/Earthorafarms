import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const srcToolsDir = path.dirname(fileURLToPath(new URL('../../src/tools/checkout.ts', import.meta.url)));

// The conversation tool may send only the editable review form. Razorpay
// payment-link creation belongs exclusively to routes/checkout.ts, after the
// customer has reviewed, saved, repriced, and explicitly confirmed the form.
describe('review-form delivery boundary', () => {
  const otherToolFiles = ['products.ts', 'knowledge.ts', 'cart.ts'];

  for (const file of otherToolFiles) {
    it(`${file} does not import notifications/resend`, () => {
      const contents = readFileSync(path.join(srcToolsDir, file), 'utf8');
      expect(contents).not.toMatch(/notifications\/resend/);
    });
  }

  it('the conversation checkout tool sends WhatsApp but cannot create a Razorpay link', () => {
    const contents = readFileSync(path.join(srcToolsDir, 'checkout.ts'), 'utf8');
    expect(contents).toMatch(/whatsapp-chatbot\/provider/);
    expect(contents).not.toMatch(/payments\/razorpay-links/);
    expect(contents).not.toMatch(/freezeCheckoutPricing/);
  });

  it('create_verification_link never returns the raw token or URL to the caller', () => {
    const contents = readFileSync(path.join(srcToolsDir, 'checkout.ts'), 'utf8');
    // The handler's return statements must not include verificationUrl/rawToken.
    const handlerReturn = contents.slice(contents.indexOf('createVerificationLinkTool'));
    expect(handlerReturn).not.toMatch(/return\s*\{\s*ok:\s*true,\s*(rawToken|verificationUrl)/);
  });

  it('Razorpay creation remains behind the reviewed checkout route', () => {
    const routePath = fileURLToPath(new URL('../../src/routes/checkout.ts', import.meta.url));
    const contents = readFileSync(routePath, 'utf8');
    expect(contents).toMatch(/createPaymentLinkBodySchema\.safeParse/);
    expect(contents).toMatch(/session\.status !== 'repriced'/);
    expect(contents).toMatch(/createPaymentLink\(/);
  });
});
