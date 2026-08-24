import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const srcToolsDir = path.dirname(fileURLToPath(new URL('../../src/tools/checkout.ts', import.meta.url)));

// create_verification_link is the only tool allowed to trigger an email
// (see src/tools/checkout.ts). This is a static module-boundary check: no
// OTHER tool file may import notifications/resend.ts at all, so there is no
// way for a future edit to a different tool to accidentally start sending
// email outside that one code path.
describe('email-sending boundary', () => {
  const otherToolFiles = ['products.ts', 'knowledge.ts', 'cart.ts'];

  for (const file of otherToolFiles) {
    it(`${file} does not import notifications/resend`, () => {
      const contents = readFileSync(path.join(srcToolsDir, file), 'utf8');
      expect(contents).not.toMatch(/notifications\/resend/);
    });
  }

  it('checkout.ts (which legitimately sends email) does import notifications/resend', () => {
    const contents = readFileSync(path.join(srcToolsDir, 'checkout.ts'), 'utf8');
    expect(contents).toMatch(/notifications\/resend/);
  });

  it('create_verification_link never returns the raw token or URL to the caller', () => {
    const contents = readFileSync(path.join(srcToolsDir, 'checkout.ts'), 'utf8');
    // The handler's return statements must not include verificationUrl/rawToken.
    const handlerReturn = contents.slice(contents.indexOf('createVerificationLinkTool'));
    expect(handlerReturn).not.toMatch(/return\s*\{\s*ok:\s*true,\s*(rawToken|verificationUrl)/);
  });
});
