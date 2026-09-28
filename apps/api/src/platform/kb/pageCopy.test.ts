import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAGE_SOURCES, extractPageCopy, extractPages, keepable } from './pageCopy.js';

const pagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'storefront', 'src', 'pages');

describe('storefront page copy extraction', () => {
  it('keeps readable sentences and drops class lists, code and links', () => {
    expect(keepable('Free standard shipping on all prepaid orders across India.')).toBe(true);
    expect(keepable('flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10')).toBe(false);
    expect(keepable('mailto:contactus@earthorafarms.com')).toBe(false);
    expect(keepable('const x = 1;')).toBe(false);
    expect(keepable('Learn more')).toBe(false);
  });

  it('extracts JSX text and content strings from a page in document order, once each', async () => {
    const source = `
      const items = [{ title: "Complimentary Shipping", desc: "Free standard shipping on all prepaid orders across India." }];
      export default function Page() {
        return <section className="pt-36 pb-20 bg-[#0E0E0E]">
          <h1 className="font-dm">Farm to Doorstep Logistics for every order</h1>
          <p>Free standard shipping on all prepaid orders across India.</p>
          <a href="/faq">Read the FAQ page</a>
        </section>;
      }`;
    const text = await extractPageCopy(source, 'Shipping (website)');
    expect(text.split('\n')).toEqual([
      '# Shipping (website)',
      'Free standard shipping on all prepaid orders across India.',
      'Farm to Doorstep Logistics for every order',
      'Read the FAQ page',
    ]);
  });

  it('reads the real storefront pages and finds their known copy', async () => {
    const pages = await extractPages(pagesDir);
    expect(pages.map((p) => p.path)).toEqual(PAGE_SOURCES.map((p) => p.path));
    const faq = pages.find((p) => p.path === '/faq')!;
    expect(faq.text).toMatch(/caffeine/i);
    expect(faq.words).toBeGreaterThan(300);
    const contact = pages.find((p) => p.path === '/contact')!;
    expect(contact.text).toMatch(/Operating Hours|Mon/);
    for (const page of pages) {
      expect(page.words).toBeGreaterThan(40);
      expect(page.text).not.toMatch(/className|bg-\[#|flex items-center/);
    }
  });
});
