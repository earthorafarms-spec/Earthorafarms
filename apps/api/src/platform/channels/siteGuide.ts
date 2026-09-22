import type { ToolDef } from '../providers/types.js';

export interface SiteDestination { id: string; label: string; path: string; anchor: string | null; description: string }
const pages: SiteDestination[] = [
  ['home', 'Home', '/', null, 'Earthora storefront introduction'],
  ['products', 'Products', '/', 'products', 'Current products and live prices'],
  ['cart', 'Your cart', '/cart', null, 'Review products and quantities before checkout'],
  ['home_benefits', 'Moringa benefits', '/', 'benefits', 'Homepage benefits overview'],
  ['home_testimonials', 'Customer stories', '/', 'testimonials', 'Homepage testimonials'],
  ['home_faq', 'Common questions', '/', 'faq', 'Homepage FAQs'],
  ['our_story', 'Our story', '/our-story', null, 'Earthora farm and brand story'],
  ['health_benefits', 'Health benefits', '/health-benefits', null, 'Moringa benefits page'],
  ['contact', 'Contact Earthora', '/contact', null, 'Contact information and enquiry form'],
  ['contact_form', 'Send an enquiry', '/contact', 'contact-form', 'Name, email and message form; wholesale and other enquiries'],
  ['faq', 'Frequently asked questions', '/faq', null, 'Product and order FAQs'],
  ['shipping_policy', 'Shipping policy', '/shipping-policy', null, 'Shipping and delivery information'],
  ['privacy_policy', 'Privacy policy', '/privacy-policy', null, 'Data and privacy policy'],
  ['terms_of_use', 'Terms of use', '/terms-of-use', null, 'Store terms'],
].map(([id, label, path, anchor, description]) => ({ id: id!, label: label!, path: path!, anchor, description: description! }));

export function siteGuide(products: { id: string; name: string; status?: string }[]): SiteDestination[] {
  return [...pages, ...products.filter(p => p.status === undefined || p.status === 'active').map(p => ({
    id: 'product:' + p.id, label: p.name, path: '/product/' + encodeURIComponent(p.id), anchor: null, description: 'Current product details',
  }))];
}

export const navigationTool: ToolDef = {
  name: 'navigate_site', description: 'Guide the visitor by opening a relevant listed Earthora page/section, including when it helps the current question. Use an exact site_guide id. Wait for client acknowledgement before claiming it opened.',
  parameters: { type: 'object', properties: { destination_id: { type: 'string' } }, required: ['destination_id'], additionalProperties: false },
};

export const scrollTool: ToolDef = {
  name: 'scroll_page', description: 'Scroll the current website page up or down one screen, or to its top or bottom. Use when the visitor asks to scroll; wait for browser acknowledgement.',
  parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] } }, required: ['direction'], additionalProperties: false },
};

export function navigationResult(channel: string, destination: unknown, products: Parameters<typeof siteGuide>[0]) {
  if (channel !== 'web') return { ok: false, message: 'Browser navigation is unavailable on a phone call.' };
  const match = siteGuide(products).find(item => item.id === destination);
  if (!match) return { ok: false, message: 'Unknown destination. Choose an exact site_guide id.' };
  return { ok: true, data: { navigation: { destination_id: match.id, path: match.path, anchor: match.anchor, label: match.label } } };
}
