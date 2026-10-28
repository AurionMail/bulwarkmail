import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import de from '@/locales/de/common.json';
import en from '@/locales/en/common.json';

// The setup wizard follows the browser's language like the login page,
// instead of being English only.

vi.unmock('next-intl');
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async () => new Response(JSON.stringify({ state: 'bootstrap', authenticated: false, readOnly: false, partialConfig: null }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })),
  getPathPrefix: () => '',
  withBasePath: (p: string) => p,
}));
vi.mock('@/lib/setup/url-token', () => ({ takeSetupTokenFromUrl: () => '' }));

const { default: SetupWizardPage } = await import('../page');

function renderIn(locale: string, messages: Record<string, unknown>) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <SetupWizardPage />
    </NextIntlClientProvider>,
  );
}

describe('setup wizard language', () => {
  it('shows the welcome step in German', async () => {
    renderIn('de', de);
    expect(await screen.findByText('Einrichtungstoken')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Einrichtung von Bulwark Webmail');
    expect(screen.getByRole('button', { name: 'Fortfahren' })).toBeTruthy();
    expect(screen.queryByText('Setup token')).toBeNull();
  });

  it('shows it in English for English', async () => {
    renderIn('en', en);
    expect(await screen.findByText('Setup token')).toBeTruthy();
    expect(screen.getByText('Server')).toBeTruthy();
  });
});
