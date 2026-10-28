import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAdminUnsavedStore } from '@/stores/admin-unsaved-store';

// Typing into an empty field and deleting it again left "Unsaved changes"
// up: the page compared "" with a key that was never set.

vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async () => new Response(JSON.stringify({
    appName: { source: 'admin', value: 'Mail' },
    domainBranding: { source: 'admin', value: [{ host: 'mail.example.com' }] },
  }), { status: 200, headers: { 'content-type': 'application/json' } })),
  withBasePath: (p: string) => p,
  getPathPrefix: () => '',
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/stores/toast-store', () => ({ toast, useToastStore: () => [] }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

import { BrandingPage } from '../_pages/branding';
import { SettingsPage } from '../_pages/settings';

afterEach(() => {
  useAdminUnsavedStore.setState({ dirty: {}, pendingLeave: null, pendingScope: null });
});

describe('admin save bar and blank fields', () => {
  it('goes away when an unset branding field is typed into and emptied again', async () => {
    render(<BrandingPage />);
    const company = await screen.findByRole('textbox', { name: 'Company name' });
    fireEvent.change(company, { target: { value: 'A' } });
    expect(screen.getByTestId('admin-save-bar')).toBeInTheDocument();
    fireEvent.change(company, { target: { value: '' } });
    expect(screen.queryByTestId('admin-save-bar')).toBeNull();
  });

  it('does the same for a single domain', async () => {
    render(<BrandingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'mail.example.com' }));
    const company = screen.getByRole('textbox', { name: 'Company name' });
    fireEvent.change(company, { target: { value: 'A' } });
    expect(screen.getByTestId('admin-save-bar')).toBeInTheDocument();
    fireEvent.change(company, { target: { value: '' } });
    expect(screen.queryByTestId('admin-save-bar')).toBeNull();
  });

  it('goes away when a settings field is put back to its saved value', async () => {
    render(<SettingsPage />);
    const url = await screen.findByRole('textbox', { name: 'JMAP server URL' });
    fireEvent.change(url, { target: { value: 'h' } });
    expect(screen.getByTestId('admin-save-bar')).toBeInTheDocument();
    fireEvent.change(url, { target: { value: '' } });
    expect(screen.queryByTestId('admin-save-bar')).toBeNull();

    const name = screen.getByRole('textbox', { name: 'Application name' });
    fireEvent.change(name, { target: { value: 'Mail2' } });
    expect(screen.getByTestId('admin-save-bar')).toBeInTheDocument();
    fireEvent.change(name, { target: { value: 'Mail' } });
    expect(screen.queryByTestId('admin-save-bar')).toBeNull();
  });
});
