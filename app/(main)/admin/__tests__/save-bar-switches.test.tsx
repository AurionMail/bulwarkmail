import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminUnsavedStore } from '@/stores/admin-unsaved-store';

// On an admin page with a save bar, every control waits for Save: the
// per-plugin switch and the telemetry consent used to save at once, next to
// policy switches that waited.

const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
const routes: Record<string, unknown> = {};
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) });
    const data = method === 'GET' ? routes[url.split('?')[0]] ?? {} : { ok: true };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  }),
  withBasePath: (p: string) => p,
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../_pages/plugin-approvals-panel', () => ({ PluginApprovalsPanel: () => null }));
vi.mock('../_pages/use-extension-icons', () => ({ useExtensionIcons: () => () => null }));

import { PluginsPage } from '../_pages/plugins';
import { TelemetryPage } from '../_pages/telemetry';

const writes = () => calls.filter((c) => c.method !== 'GET');

beforeEach(() => {
  calls.length = 0;
  routes['/api/admin/plugins'] = [
    { id: 'jitsi', name: 'Jitsi', version: '1.0.0', enabled: true, author: 'x', description: '', permissions: [] },
  ];
  routes['/api/admin/policy'] = { features: {}, themePolicy: {} };
  routes['/api/admin/telemetry'] = {
    consent: 'off', consentSource: 'file', endpoint: 'https://t.example', defaultEndpoint: 'https://t.example',
    consentedAt: null, lastSentAt: null, nextScheduledAt: null, payloadPreview: {}, accountCounts: { total: 0, active7d: 0 },
  };
});
afterEach(() => {
  useAdminUnsavedStore.setState({ dirty: {}, pendingLeave: null, pendingScope: null });
});

describe('admin plugins page', () => {
  it('turns a plugin off only when Save is pressed', async () => {
    render(<PluginsPage />);
    const toggle = await screen.findByRole('switch', { name: 'Jitsi enabled' });
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(writes()).toEqual([]);
    expect(useAdminUnsavedStore.getState().dirty).toEqual({ plugins: true });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toEqual([
      expect.objectContaining({ url: '/api/admin/plugins', method: 'PATCH', body: { id: 'jitsi', enabled: false } }),
    ]));
    await waitFor(() => expect(useAdminUnsavedStore.getState().dirty).toEqual({}));
  });

  it('puts the switch back on Discard without saving', async () => {
    render(<PluginsPage />);
    const toggle = await screen.findByRole('switch', { name: 'Jitsi enabled' });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(writes()).toEqual([]);
  });
});

describe('admin telemetry page', () => {
  it('sends the consent only when Save is pressed', async () => {
    render(<TelemetryPage />);
    const consent = await screen.findByRole('switch', { name: 'Send anonymous heartbeats' });
    fireEvent.click(consent);
    expect(writes()).toEqual([]);
    expect(screen.getByTestId('admin-save-bar')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toEqual([
      expect.objectContaining({ url: '/api/admin/telemetry', body: { action: 'set-consent', consent: 'on' } }),
    ]));
  });

  it('shows no next send and no consent date while heartbeats are off', async () => {
    routes['/api/admin/telemetry'] = {
      ...(routes['/api/admin/telemetry'] as object),
      consent: 'off', consentedAt: '2026-10-01T10:00:00Z', lastSentAt: '2026-10-02T10:00:00Z',
      nextScheduledAt: new Date(Date.now() - 7 * 3600_000).toISOString(),
    };
    render(<TelemetryPage />);
    await screen.findByRole('switch', { name: 'Send anonymous heartbeats' });
    expect(screen.queryByText('Next scheduled')).toBeNull();
    expect(screen.queryByText('Consented at')).toBeNull();
    expect(screen.queryByText(/hours ago/)).toBeNull();
    expect(screen.getByText('Last sent')).toBeTruthy();
  });

  it('shows a past next send as due, not as "hours ago", while heartbeats are on', async () => {
    routes['/api/admin/telemetry'] = {
      ...(routes['/api/admin/telemetry'] as object),
      consent: 'on', consentedAt: '2026-10-01T10:00:00Z',
      nextScheduledAt: new Date(Date.now() - 7 * 3600_000).toISOString(),
    };
    render(<TelemetryPage />);
    await screen.findByText('Next scheduled');
    expect(screen.getByText('Due now')).toBeTruthy();
    expect(screen.getByText('Consented at')).toBeTruthy();
  });
});
