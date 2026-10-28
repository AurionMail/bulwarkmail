import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The login page in another language: the subtitle, the theme menu and the
// version details come from the translations, and the version details open
// from the keyboard, not only on hover.

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'de' }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/login',
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/login',
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks/use-config', () => ({
  useConfig: () => ({
    appName: 'Webmail',
    isLoading: false,
    error: null,
    jmapServerUrl: 'https://mail.example.org',
    jmapServers: [],
    loginShowHeading: true,
    loginShowSubtitle: true,
    loginShowVersion: true,
    loginShowTotp: true,
    loginShowRememberMe: true,
  }),
}));

const { default: LoginPage } = await import('../page');

describe('login page translations', () => {
  it('shows the translated subtitle whatever the app is called', async () => {
    render(<LoginPage />);
    expect(await screen.findByText('subtitle', {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.queryByText('Sign in to your account')).toBeNull();
  }, 30_000);

  it('labels the theme menu from the translations', async () => {
    render(<LoginPage />);
    const button = await screen.findByRole('button', { name: 'label: system' }, { timeout: 10000 });
    fireEvent.click(button);
    expect(screen.getByRole('menu', { name: 'label' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'dark' })).toBeInTheDocument();
  }, 30_000);

  it('opens the version details from a button', async () => {
    render(<LoginPage />);
    const trigger = await screen.findByRole('button', { name: /^v\d/ }, { timeout: 10000 });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    act(() => { fireEvent.click(trigger); });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const details = screen.getByRole('group', { name: 'details' });
    expect(details).toHaveTextContent('version_line');
    expect(screen.getByRole('button', { name: 'copy' })).toBeInTheDocument();
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }, 30_000);
});
