import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import de from '@/locales/de/common.json';
import en from '@/locales/en/common.json';

// The setup wizard follows the browser's language like the login page,
// instead of being English only.

vi.unmock('next-intl');
const status = vi.hoisted(() => ({ readOnly: false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async () => new Response(JSON.stringify({ state: 'bootstrap', authenticated: false, readOnly: status.readOnly, partialConfig: null }), {
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

// Variables, URLs and paths in the texts are shown as code, not as words.
describe('setup wizard literals', () => {
  afterEach(() => { status.readOnly = false; });

  it('shows the read-only variable as code, in every language', async () => {
    status.readOnly = true;
    const { unmount } = renderIn('en', en);
    const variable = await screen.findByText('ADMIN_CONFIG_READONLY');
    expect(variable.tagName).toBe('CODE');
    expect(variable.parentElement!.textContent).toBe(
      'The config volume is mounted read-only or ADMIN_CONFIG_READONLY is set. Remount it read-write or unset that variable, then restart the container.',
    );
    unmount();

    renderIn('de', de);
    expect((await screen.findByText('ADMIN_CONFIG_READONLY')).tagName).toBe('CODE');
  });

  it('marks the literal in each of those texts as code in all languages', () => {
    const dir = join(process.cwd(), 'locales');
    const pick = (o: Record<string, unknown>, path: string) =>
      path.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], o) as string;
    for (const locale of readdirSync(dir)) {
      const setup = JSON.parse(readFileSync(join(dir, locale, 'common.json'), 'utf8')).setup;
      expect.soft(pick(setup, 'read_only.body'), locale).toContain('<code>{variable}</code>');
      expect.soft(pick(setup, 'server.http_body'), locale).toContain('<code>{https}</code>');
      expect.soft(pick(setup, 'server.local_body'), locale).toContain('<code>{example}</code>');
      expect.soft(pick(setup, 'review.password_hint'), locale).toContain('<code>{path}</code>');
    }
  });
});
