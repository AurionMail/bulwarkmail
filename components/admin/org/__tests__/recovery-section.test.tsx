import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Organisation > Sharing > Deleted items: the days limit per scope, the
// deletedItemsRecovery hide switch, and what Stalwart needs for it to work.

const puts: Array<Record<string, unknown>> = [];
let stored: Record<string, unknown> = {};
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async (_url: string, init?: RequestInit) => {
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

import { RecoverySection } from '../sections/recovery-section';
import { useOrgPolicyDraft, useOrgScopeStore, EVERYONE } from '../use-org-policy-draft';

const POLICY = {
  restrictions: {}, features: {}, defaults: {}, themePolicy: {},
  forceEnabledPlugins: [], approvedPlugins: [], forceEnabledThemes: [],
  organisation: {},
  scopes: [{ id: 'two', label: 'Org two', match: { domains: ['org-two.test'] }, policy: {} }],
};

let latest: ReturnType<typeof useOrgPolicyDraft> | null = null;
function Harness() {
  const draft = useOrgPolicyDraft('test');
  latest = draft;
  if (draft.loading) return null;
  return <RecoverySection draft={draft} />;
}

async function renderSection() {
  render(<Harness />);
  await waitFor(() => expect(screen.getByTestId('org-recovery-requirements')).toBeInTheDocument());
}

beforeEach(() => {
  puts.length = 0;
  stored = JSON.parse(JSON.stringify(POLICY));
  latest = null;
  useOrgScopeStore.setState({ scopeId: EVERYONE });
});

describe('Recover deleted items section', () => {
  it('says it needs the Enterprise license and archiving in Stalwart, with the docs', async () => {
    await renderSection();
    const note = screen.getByTestId('org-recovery-requirements');
    expect(note.textContent).toContain('Stalwart Enterprise license');
    expect(note.textContent).toContain('archiveDeletedItemsFor');
    expect(screen.getByRole('link', { name: 'How to set it up' }).getAttribute('href')).toBe('https://bulwarkmail.org/docs/guides/organisation/recover-deleted-items');
  });

  it('saves the days limit, with empty meaning everything the server keeps', async () => {
    await renderSection();
    const field = screen.getByLabelText('Show deleted mail of the last (days)') as HTMLInputElement;
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: '14' } });
    await act(async () => { await latest!.save(); });
    expect((puts[0].organisation as { recovery: unknown }).recovery).toEqual({ days: 14 });
    fireEvent.change(field, { target: { value: '' } });
    expect(latest!.orgValue('recovery', 'days').value).toBe(0);
  });

  it('writes a scope override only into that scope', async () => {
    await renderSection();
    act(() => latest!.setScopeId('two'));
    fireEvent.change(screen.getByLabelText('Show deleted mail of the last (days)'), { target: { value: '7' } });
    expect(latest!.policy?.scopes?.[0].policy.organisation).toEqual({ recovery: { days: 7 } });
    expect(latest!.policy?.organisation?.recovery.days).toBe(0);
  });

  it('hides the feature for users through deletedItemsRecovery', async () => {
    await renderSection();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide' }));
    expect(latest!.restriction('deletedItemsRecovery').value).toEqual({ hidden: true });
  });
});
