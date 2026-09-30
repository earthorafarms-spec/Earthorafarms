import { describe, expect, it } from 'vitest';
import powderImg from '@assets/generated_images/product_powder.jpg';
import tabletsImg from '@assets/generated_images/product_tablets.jpg';
import { productImageFallback } from './productImageFallback';

describe('catalogue placeholder imagery', () => {
  it('uses tablet imagery for the current full tablet slug and unknown products', () => {
    expect(productImageFallback('Morilife+ Moringa Leaf Tablets', 'morilife-moringa-leaf-tablets').main).toBe(tabletsImg);
    expect(productImageFallback('New product', 'new-product').main).toBe(tabletsImg);
  });

  it('preserves powder imagery for an explicitly named future powder product', () => {
    expect(productImageFallback('Moringa Leaf Powder', 'moringa-leaf-powder').main).toBe(powderImg);
  });
});
