// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: (_target, tag: string) => tag }),
}));
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }));
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import Contact from './contact';

let root: Root;
let mount: HTMLDivElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  act(() => root.render(<Contact />));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('contact form', () => {
  it('provides accessible field names and requires an explicit marketing opt-in', () => {
    for (const [id, label] of [
      ['contact-name', 'Full Name'],
      ['contact-email', 'Email Address'],
      ['contact-phone', 'Phone Number'],
      ['contact-topic', 'Topic'],
      ['contact-message', 'Message'],
    ]) {
      const field = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
      expect(field).toBeTruthy();
      expect(field.labels?.[0]?.textContent?.trim()).toBe(label);
    }
    const consent = document.getElementById('contact-marketing-consent') as HTMLInputElement;
    expect(consent.checked).toBe(false);
    expect(consent.labels?.[0]?.textContent).toContain('Keep me updated via WhatsApp');
  });
});
