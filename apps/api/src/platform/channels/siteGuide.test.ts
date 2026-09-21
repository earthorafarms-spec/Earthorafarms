import { describe, expect, it } from 'vitest';
import { navigationResult, siteGuide } from './siteGuide.js';

describe('finite public website guide', () => {
  const products = [{ id: 'p1', name: 'Current product', status: 'active' }, { id: 'p2', name: 'Old', status: 'inactive' }];
  it('uses only matching storefront paths and deliberate section anchors', () => {
    const destinations = siteGuide(products);
    expect(destinations.find(d => d.id === 'contact_form')).toMatchObject({ path: '/contact', anchor: 'contact-form' });
    expect(destinations.find(d => d.id === 'products')).toMatchObject({ path: '/', anchor: 'products' });
    expect(destinations.some(d => d.id === 'cart')).toBe(false);
    expect(destinations.find(d => d.id === 'product:p1')?.path).toBe('/product/p1');
    expect(destinations.some(d => d.id === 'product:p2')).toBe(false);
    expect(destinations.every(d => d.path.startsWith('/') && !d.path.startsWith('//'))).toBe(true);
  });
  it.each(['https://example.com', '//example.com', '/sun-earthora', 'product:p2', 'unknown', 'contact#evil'])('rejects unlisted navigation %s', id => {
    expect(navigationResult('web', id, products).ok).toBe(false);
  });
  it('returns client navigation intent but never claims the browser opened it', () => {
    expect(navigationResult('web', 'contact_form', products)).toEqual({ ok: true, data: { navigation: { destination_id: 'contact_form', path: '/contact', anchor: 'contact-form', label: 'Send an enquiry' } } });
    expect(navigationResult('phone', 'contact', products).ok).toBe(false);
  });
});
