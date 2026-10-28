import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { finalizeOutgoing, resetSendPipeline, type OutgoingContext } from '@/lib/outgoing/send-pipeline';
import { registerOrgOutgoing } from '@/lib/org/outgoing';
import { resetAccountSubjects } from '@/lib/org/account-subjects';
import { useOrgSignatureSetup } from '@/hooks/use-org-signature';
import { DEFAULT_POLICY, type SettingsPolicy } from '@/lib/admin/types';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { resolvePolicy } from '@/lib/admin/policy-scopes';
import { usePolicyStore } from '@/stores/policy-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useIdentityStore } from '@/stores/identity-store';
import { useAuthStore } from '@/stores/auth-store';
import type { Identity } from '@/lib/jmap/types';

// A message from another signed-in account than the active one gets that
// account's domain and group scopes, not the active account's.

const RAW: SettingsPolicy = {
  ...DEFAULT_POLICY,
  restrictions: { signature: { locked: true } },
  organisation: { ...DEFAULT_ORGANISATION_POLICY, disclaimer: { html: '', text: 'Everyone disclaimer' } },
  scopes: [
    { id: 'example', label: 'Example', match: { domains: ['example.org'] }, policy: { organisation: { signature: { text: 'Example {name}' } } } },
    { id: 'two', label: 'Two', match: { domains: ['org-two.test'] }, policy: { organisation: { signature: { text: 'Two {name}' }, disclaimer: { text: 'Two disclaimer' } } } },
    { id: 'team', label: 'Team', match: { groups: ['team@org-two.test'] }, policy: { organisation: { signature: { text: 'Team {name}' } } } },
  ],
};
const ALICE = { email: 'alice@example.org', groups: [] };

const DAVE_CLIENT = {
  getUsername: () => 'dave@org-two.test',
  getSharedAccounts: () => [{ id: 'g1', name: 'team@org-two.test', isPrimary: false }],
  getAccountInfo: () => ({ isPersonal: false }),
  getPrincipalTypes: async () => ({ g1: 'group' }),
};

const CONTEXT: OutgoingContext = {
  surface: 'composer', to: ['bob@example.com'], cc: [], bcc: [], mode: 'compose', plainText: true,
};

const original = useAuthStore.getState();

beforeEach(() => {
  resetSendPipeline();
  registerOrgOutgoing();
  resetAccountSubjects();
  useAuthStore.setState({
    activeAccountId: 'a1',
    getClientForAccount: (id: string) => (id === 'a2' ? DAVE_CLIENT : undefined),
  } as never);
  // After the auth store: its subscription resolves the policy again on a change.
  usePolicyStore.setState({ rawPolicy: RAW, policy: resolvePolicy(RAW, ALICE).policy, subject: ALICE });
  useIdentityStore.setState({ identities: [{ id: 'id-alice', name: 'Alice', email: 'alice@example.org', mayDelete: false } as Identity] });
  useSettingsStore.setState({ signatureSeparatorEnabled: true });
});
afterEach(() => {
  resetSendPipeline();
  resetAccountSubjects();
  useAuthStore.setState({ activeAccountId: original.activeAccountId, getClientForAccount: original.getClientForAccount } as never);
  usePolicyStore.setState({ policy: DEFAULT_POLICY, rawPolicy: DEFAULT_POLICY, subject: null });
});

describe('the account a message goes out from', () => {
  it("gives the active account's identities its own scopes", () => {
    const out = finalizeOutgoing(finalizeOutgoing({ text: 'Hi' }, { ...CONTEXT, identityId: 'id-alice', fromEmail: 'alice@example.org' }), CONTEXT, 'last');
    expect(out.text).toBe('Hi\n\n-- \nExample Alice\n\nEveryone disclaimer');
  });

  it("gives another account's identity that account's scopes, from the sender or from a prefixed id", () => {
    const sender = { ...CONTEXT, sender: { name: 'Dave', email: 'dave@org-two.test', accountId: 'a2' } };
    expect(finalizeOutgoing(finalizeOutgoing({ text: 'Hi' }, sender), sender, 'last').text)
      .toBe('Hi\n\n-- \nTwo Dave\n\nTwo disclaimer');
    const prefixed = { ...CONTEXT, identityId: 'a2::id-dave', fromEmail: 'dave@org-two.test' };
    expect(finalizeOutgoing({ text: 'Hi' }, prefixed, 'last').text).toBe('Hi\n\nTwo disclaimer');
  });

  it("follows that account's groups once they are known", async () => {
    const team = { name: 'Team', email: 'team@org-two.test' };
    const { result } = renderHook(() => useOrgSignatureSetup(team, 'a2'));
    await waitFor(() => expect(result.current.signature?.text).toBe('Team Team'));
    // The active account isn't in that group: its domain's signature.
    expect(renderHook(() => useOrgSignatureSetup(team)).result.current.signature?.text).toBe('Example Team');
  });
});
