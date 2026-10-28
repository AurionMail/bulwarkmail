import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin' }));
vi.mock('@/components/layout/navigation-rail', () => ({ NavigationRail: () => null }));
vi.mock('@/components/settings/about-data-settings', () => ({ AboutFooter: () => null }));
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: false })),
  getPathPrefix: () => '',
  withBasePath: (href: string) => href,
}));

import { AdminShell } from '../admin-shell';
import { useUpdateStore } from '@/stores/update-store';

function setDesktop(desktop: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: desktop && query.includes('min-width: 1024px'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function shell(props: { authenticated: boolean; isStalwartAutoLogin: boolean }) {
  return (
    <AdminShell {...props} configReadOnly={false} onLogout={() => {}}>
      <p>page</p>
    </AdminShell>
  );
}

describe('AdminShell', () => {
  beforeEach(() => {
    setDesktop(true);
    Element.prototype.scrollTo = () => {};
  });

  it('does not server-render the phone layout, which desktop would show until hydration', () => {
    const html = renderToString(shell({ authenticated: false, isStalwartAutoLogin: false }));
    expect(html).not.toContain('back_to_mail');
    expect(html).not.toContain('Search admin');
  });

  it('draws the desktop sidebar once on the client', () => {
    render(shell({ authenticated: true, isStalwartAutoLogin: false }));
    expect(screen.getByText('back_to_mail')).toBeTruthy();
  });

  it('hides the session links until the check says which kind of admin this is', () => {
    const { rerender } = render(shell({ authenticated: false, isStalwartAutoLogin: false }));
    expect(screen.queryByText('Sign out of admin')).toBeNull();
    rerender(shell({ authenticated: true, isStalwartAutoLogin: true }));
    expect(screen.queryByText('Sign out of admin')).toBeNull();
    rerender(shell({ authenticated: true, isStalwartAutoLogin: false }));
    expect(screen.getByText('Sign out of admin')).toBeTruthy();
    expect(screen.getByText('Change password')).toBeTruthy();
  });

  // The dot next to Version was a span with aria-label, which screen
  // readers don't announce.
  it('announces a waiting update on the Version entry', () => {
    useUpdateStore.setState({
      status: { updateAvailable: true, severity: 'minor', current: process.env.NEXT_PUBLIC_APP_VERSION ?? '', latest: '9.9.9' },
      startPolling: () => {},
    } as never);
    render(shell({ authenticated: true, isStalwartAutoLogin: false }));
    const dot = screen.getAllByRole('img', { name: 'update_available' })[0];
    expect(dot.getAttribute('title')).toBe('update_available');
  });

  // Translated like the same dot on the navigation rail (shell namespace).
  it('names an important update in the language of the user', () => {
    useUpdateStore.setState({
      status: { updateAvailable: true, severity: 'security', current: process.env.NEXT_PUBLIC_APP_VERSION ?? '', latest: '9.9.9' },
      startPolling: () => {},
    } as never);
    render(shell({ authenticated: true, isStalwartAutoLogin: false }));
    expect(screen.getAllByRole('img', { name: 'update_important' })[0].getAttribute('title')).toBe('update_important');
  });
});
