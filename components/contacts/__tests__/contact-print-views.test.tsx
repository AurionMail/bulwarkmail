import { cleanup, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContactCard } from '@/lib/jmap/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
  useLocale: () => 'en',
}));

import { ContactListPrint, ContactPrintSheet } from '../contact-print-views';

const card = (id: string, name: string, extra: Partial<ContactCard> = {}): ContactCard => ({
  id, addressBookIds: {}, name: { full: name }, ...extra,
} as ContactCard);

const root = () => document.querySelector('[data-print-root]') as HTMLElement;

beforeEach(() => { document.body.innerHTML = ''; });

describe('ContactListPrint', () => {
  const ann = card('a', 'Ann Lee', { emails: { e: { address: 'ann@example.com' } }, phones: { p: { number: '+1 555 0100' } }, organizations: { o: { name: 'Acme' } } } as Partial<ContactCard>);
  const bob = card('b', 'Bob Stone');
  const bea = card('c', 'Bea Long-Name-Without-Any-Email');

  it('prints name, primary email, phone and organization, empty where a contact has none', () => {
    render(<ContactListPrint title="Work" contacts={[ann, bob]} />);
    const rows = [...root().querySelectorAll('.pr-contact-row')].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ['Ann Lee', 'ann@example.com', '+1 555 0100', 'Acme'],
      ['Bob Stone', '', '', ''],
    ]);
    expect(root().querySelector('.pr-meta')?.textContent).toBe('print.count{"count":2}');
  });

  it('heads each letter group and keeps the heading with its first row', () => {
    render(<ContactListPrint title="All" contacts={[ann, bea, bob]} sections={[{ letter: 'A', items: [ann] }, { letter: 'B', items: [bea, bob] }]} />);
    const keeps = [...root().querySelectorAll('.pr-keep')];
    expect(keeps.map((k) => [k.querySelector('.pr-letter')?.textContent, k.querySelectorAll('.pr-contact-row').length])).toEqual([['A', 1], ['B', 1]]);
    expect(root().querySelectorAll('.pr-contact-row')).toHaveLength(3);
  });

  it('names the search the list was narrowed by', () => {
    render(<ContactListPrint title="All" contacts={[ann]} searchQuery=" acme " />);
    expect(root().querySelector('.pr-meta')?.textContent).toContain('print.search{"query":"acme"}');
  });
});

describe('ContactPrintSheet', () => {
  it('prints the notes as text, not markup', () => {
    render(<ContactPrintSheet contact={card('a', 'Ann Lee', { notes: { n: { note: '<script>alert(1)</script> <b>x</b>' } } } as Partial<ContactCard>)} />);
    expect(root().querySelector('script, b')).toBeNull();
    expect(root().querySelector('.pr-text')?.textContent).toBe('<script>alert(1)</script> <b>x</b>');
  });

  it('shows the photo it was given, or the initial', () => {
    render(<ContactPrintSheet contact={card('a', 'Ann Lee')} photoUri="data:image/jpeg;base64,/9j/" />);
    expect(root().querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/');
    cleanup();
    render(<ContactPrintSheet contact={card('a', 'ann Lee')} />);
    expect(root().querySelector('.pr-photo.is-placeholder')?.textContent).toBe('A');
  });
});
