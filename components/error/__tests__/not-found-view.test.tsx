import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A mistyped URL with a still valid session: the 404 waits for the session
// to be restored instead of sending the user to the login page.

const { default: LocaleNotFound } = await import('@/app/(main)/[locale]/not-found');
const { useAuthStore } = await import('@/stores/auth-store');

const realLocation = window.location;
let href = '';

beforeEach(() => {
  href = 'http://localhost/de/gibtsnicht';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...realLocation,
      pathname: '/de/gibtsnicht',
      get href() { return href; },
      set href(v: string) { href = v; },
    },
  });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('404 page', () => {
  it('restores the session before deciding, and shows the translated page to a signed-in user', async () => {
    let finish: () => void = () => {};
    const checkAuth = vi.fn(() => new Promise<void>((resolve) => {
      finish = () => { useAuthStore.setState({ isAuthenticated: true } as never); resolve(); };
    }));
    useAuthStore.setState({ isAuthenticated: false, checkAuth } as never);

    render(<LocaleNotFound />);
    expect(checkAuth).toHaveBeenCalled();
    expect(href).not.toContain('/login');

    await act(async () => { finish(); });
    expect(href).not.toContain('/login');
    expect(screen.getByRole('heading', { name: 'title' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'go_home' })).toBeInTheDocument();
  });

  it('sends a visitor without a session to the login page once that is known', async () => {
    const checkAuth = vi.fn(() => Promise.resolve());
    useAuthStore.setState({ isAuthenticated: false, checkAuth } as never);
    render(<LocaleNotFound />);
    await act(async () => {});
    expect(href).toBe('/login');
  });
});
