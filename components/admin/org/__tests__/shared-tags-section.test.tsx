import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Organisation > Sharing > Shared tags: one sentence and the lock for the
// `sharedTags` restriction, written at the scope chosen in the scope bar.

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

import { SharedTagsSection } from '../sections/shared-tags-section';
import { useOrgPolicyDraft, useOrgScopeStore, EVERYONE } from '../use-org-policy-draft';
import { RESTRICTION_KEYS } from '@/lib/admin/restriction-keys';
import { resolvePolicy } from '@/lib/admin/policy-scopes';

const POLICY = {
  restrictions: {}, features: {}, defaults: {}, themePolicy: {},
  forceEnabledPlugins: [], approvedPlugins: [], forceEnabledThemes: [],
  scopes: [{ id: 'leads', label: 'Leads', match: { groups: ['leads@example.org'] }, policy: {} }],
};

let latest: ReturnType<typeof useOrgPolicyDraft> | null = null;
function Harness() {
  const draft = useOrgPolicyDraft('test');
  latest = draft;
  if (draft.loading) return null;
  return <SharedTagsSection draft={draft} />;
}

beforeEach(() => {
  puts.length = 0;
  stored = JSON.parse(JSON.stringify(POLICY));
  latest = null;
  useOrgScopeStore.setState({ scopeId: EVERYONE });
});

describe('Shared tags section', () => {
  it('registers sharedTags on the Sharing page, lock only', () => {
    expect(RESTRICTION_KEYS.find((def) => def.key === 'sharedTags')).toMatchObject({ page: 'org-sharing', modes: ['locked'] });
  });

  it('locks shared tags for everyone and unlocks them in a group scope', async () => {
    render(<Harness />);
    const section = await screen.findByTestId('org-shared-tags-section');
    expect(within(section).queryByText('Hide')).not.toBeInTheDocument();

    fireEvent.click(within(section).getByRole('checkbox'));
    expect(latest!.policy?.restrictions.sharedTags).toEqual({ locked: true });

    act(() => latest!.setScopeId('leads'));
    await waitFor(() => expect(within(screen.getByTestId('org-shared-tags-section')).getByRole('checkbox')).toBeChecked());
    fireEvent.click(within(screen.getByTestId('org-shared-tags-section')).getByRole('checkbox'));
    // In a scope an empty restriction is a real override: it unlocks.
    expect(latest!.policy?.scopes?.[0].policy.restrictions?.sharedTags).toEqual({});
    const lead = resolvePolicy(latest!.policy!, { email: 'anna@example.org', groups: ['leads@example.org'] }).policy;
    const member = resolvePolicy(latest!.policy!, { email: 'bob@example.org', groups: ['team@example.org'] }).policy;
    expect(lead.restrictions.sharedTags?.locked).not.toBe(true);
    expect(member.restrictions.sharedTags?.locked).toBe(true);

    await act(async () => { await latest!.save(); });
    expect(puts[0]).toMatchObject({
      restrictions: { sharedTags: { locked: true } },
      scopes: [{ id: 'leads', policy: { restrictions: { sharedTags: {} } } }],
    });
  });
});
