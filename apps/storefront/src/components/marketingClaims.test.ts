import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const component = (name: string) => readFileSync(join(here, 'sections', name), 'utf8');
const page = (name: string) => readFileSync(join(here, '..', 'pages', name), 'utf8');

describe('public product claims', () => {
  it('does not present unverified nutrient counts, certifications or review scores', () => {
    const copy = [
      component('HomeMarquee.tsx'), component('HomeBenefits.tsx'),
      component('HomeFAQ.tsx'), page('health-benefits.tsx'), page('product-detail.tsx'),
    ].join('\n');
    expect(copy).not.toMatch(/90\+|46\s*(?:×|active)|\b(?:7x|4x|3x)\s+more\b|2g\s*\/\s*tsp|100% Organic|Lab Certified|Heavy-metal tested|verified reviews/i);
    const homeProducts = component('HomeProducts.tsx');
    expect(homeProducts).toContain('product.reviewCount > 0');
    expect(page('product-detail.tsx')).toContain('product.reviewCount > 0');
  });
});
