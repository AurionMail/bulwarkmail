import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAdminUnsavedStore } from '@/stores/admin-unsaved-store';

// Branding per domain: the image fields said "Enter URL (uploads only for
// default scope)", cut off in the field and wrong for a single domain, which
// can upload. Only a wildcard domain takes a URL alone.

vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async () => new Response(JSON.stringify({
    domainBranding: { source: 'admin', value: [{ host: 'mail.example.com' }, { host: '*.example.com' }] },
  }), { status: 200, headers: { 'content-type': 'application/json' } })),
  withBasePath: (p: string) => p,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/stores/toast-store', () => ({ toast, useToastStore: () => [] }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

import { BrandingPage } from '../_pages/branding';

afterEach(() => {
  useAdminUnsavedStore.setState({ dirty: {}, pendingLeave: null, pendingScope: null });
});

describe('admin branding image fields', () => {
  it('offers upload for a single domain and a URL only for a wildcard, with the full hint as a title', async () => {
    render(<BrandingPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'mail.example.com' }));
    const favicon = screen.getByRole('textbox', { name: 'Favicon' });
    expect(favicon.getAttribute('placeholder')).toBe('Enter URL or upload a file');
    expect(favicon.getAttribute('title')).toBe('Enter URL or upload a file');

    fireEvent.click(screen.getByRole('button', { name: '*.example.com' }));
    const wildcardFavicon = screen.getByRole('textbox', { name: 'Favicon' });
    expect(wildcardFavicon.getAttribute('placeholder')).toBe('Enter URL');
    expect(wildcardFavicon.getAttribute('title')).toBe('Enter URL');
  });

  // R9: the result in the past tense, without "successfully".
  it('reports an upload without "successfully"', async () => {
    const { container } = render(<BrandingPage />);
    await screen.findByRole('button', { name: 'mail.example.com' });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } });

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0][0]).toBe('logo.png uploaded');
  });
});
