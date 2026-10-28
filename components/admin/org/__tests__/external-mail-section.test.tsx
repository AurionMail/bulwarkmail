import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Organisation > Security > External mail: the switches and the domain list
// go into the draft at the chosen scope, and the External Mail Warning
// plugin's safe domains can be copied in as an unsaved change.

const puts: Array<Record<string, unknown>> = [];
let stored: Record<string, unknown> = {};
let plugins: Array<Record<string, unknown>> = [];
let pluginConfig: Record<string, unknown> = {};
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/plugins') return new Response(JSON.stringify(plugins));
    if (url === '/api/admin/plugins/external-mail-warning/config') return new Response(JSON.stringify(pluginConfig));
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      puts.push(body);
      stored = body;
      return new Response('{"ok":true}');
    }
    return new Response(JSON.stringify(stored));
  }),
  withBasePath: (p: string) => p,
  getPathPrefix: () => '',
}));

import { ExternalMailSection } from '../sections/external-mail-section';
import { useOrgPolicyDraft, useOrgScopeStore, EVERYONE } from '../use-org-policy-draft';

const POLICY = {
  restrictions: {}, features: {}, defaults: {}, themePolicy: {},
  forceEnabledPlugins: [], approvedPlugins: [], forceEnabledThemes: [],
  organisation: { externalMail: { domains: ['partner.com'] } },
  scopes: [{ id: 'two', label: 'Org two', match: { domains: ['org-two.test'] }, policy: {} }],
};

let latest: ReturnType<typeof useOrgPolicyDraft> | null = null;
function Harness() {
  const draft = useOrgPolicyDraft('test');
  latest = draft;
  if (draft.loading) return null;
  return <ExternalMailSection draft={draft} />;
}

async function renderSection() {
  render(<Harness />);
  await waitFor(() => expect(screen.getByTestId('org-external-sender-label')).toBeInTheDocument());
}

beforeEach(() => {
  puts.length = 0;
  stored = JSON.parse(JSON.stringify(POLICY));
  plugins = [];
  pluginConfig = {};
  latest = null;
  useOrgScopeStore.setState({ scopeId: EVERYONE });
});

describe('External mail section', () => {
  it('starts with both switches off and saves what the admin turns on', async () => {
    await renderSection();
    expect(screen.getByTestId('org-external-sender-label').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('org-external-recipient-warning').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByTestId('org-external-sender-label'));
    fireEvent.click(screen.getByTestId('org-external-recipient-warning'));
    await act(async () => { await latest!.save(); });
    expect((puts[0].organisation as { externalMail: unknown }).externalMail).toMatchObject({ senderLabel: true, recipientWarning: true, domains: ['partner.com'] });
  });

  it('writes a scope override only into that scope', async () => {
    await renderSection();
    act(() => latest!.setScopeId('two'));
    fireEvent.click(screen.getByTestId('org-external-sender-label'));
    expect(latest!.policy?.scopes?.[0].policy.organisation).toEqual({ externalMail: { senderLabel: true } });
    expect(latest!.policy?.organisation?.externalMail.senderLabel).toBe(false);
  });

  it('takes the typed domain list apart when the field is left', async () => {
    await renderSection();
    const field = screen.getByTestId('org-external-domains');
    fireEvent.change(field, { target: { value: 'partner.com, Sister.example\n@third.test' } });
    fireEvent.blur(field);
    expect(latest!.orgValue('externalMail', 'domains').value).toEqual(['partner.com', 'sister.example', 'third.test']);
  });

  it('offers no import and no note without the plugin', async () => {
    await renderSection();
    fireEvent.click(screen.getByTestId('org-external-sender-label'));
    expect(screen.queryByTestId('org-external-import-plugin')).toBeNull();
    expect(screen.queryByTestId('org-external-plugin-note')).toBeNull();
  });

  it('asks to update an old plugin while the warnings are on and imports its safe domains as a draft change', async () => {
    plugins = [{ id: 'external-mail-warning', version: '1.5.1' }];
    pluginConfig = { safeDomains: 'partner.com, acme.example\nsub.acme.example' };
    await renderSection();
    await waitFor(() => expect(screen.getByTestId('org-external-import-plugin')).toBeInTheDocument());
    expect(screen.queryByTestId('org-external-plugin-note')).toBeNull();

    fireEvent.click(screen.getByTestId('org-external-recipient-warning'));
    expect(screen.getByTestId('org-external-plugin-note').textContent).toContain('Update or remove the External Mail Warning plugin');

    await act(async () => { fireEvent.click(screen.getByTestId('org-external-import-plugin')); });
    await waitFor(() => expect(latest!.orgValue('externalMail', 'domains').value).toEqual(['partner.com', 'acme.example', 'sub.acme.example']));
    expect(latest!.dirty).toBe(true);
    expect(puts).toHaveLength(0);
  });

  it('only suggests removing a plugin that steps back by itself', async () => {
    plugins = [{ id: 'external-mail-warning', version: '1.6.0' }];
    await renderSection();
    await waitFor(() => expect(screen.getByTestId('org-external-import-plugin')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('org-external-sender-label'));
    expect(screen.getByTestId('org-external-plugin-note').textContent).toContain('You can remove the External Mail Warning plugin');
  });
});
