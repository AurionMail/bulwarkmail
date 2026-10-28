import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Identity } from '@/lib/jmap/types';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';

// Strings with their values, so the domain can be seen in names and text.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}(${Object.values(vars).join(',')})` : key,
  useLocale: () => 'en',
}));

const { ExternalSenderChip } = await import('../external-sender-chip');

function setLabel(on: boolean) {
  usePolicyStore.setState({
    policy: {
      ...DEFAULT_POLICY,
      organisation: { ...DEFAULT_ORGANISATION_POLICY, externalMail: { ...DEFAULT_ORGANISATION_POLICY.externalMail, senderLabel: on } },
    },
  });
}

beforeEach(() => {
  setLabel(true);
  useAuthStore.setState({ identities: [{ id: 'i1', name: 'Alice', email: 'alice@example.org' } as unknown as Identity] });
});
afterEach(() => cleanup());

describe('External chip on phones and keyboards', () => {
  it('is a button whose name says the domain, and a tap shows it', () => {
    render(<ExternalSenderChip from={[{ email: 'dave@org-two.test' }]} />);
    const chip = screen.getByRole('button', { name: /org-two\.test/ });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-external-sender-detail]')?.textContent).toBe('sender_tooltip(org-two.test)');
    // Escape and a tap elsewhere close it.
    fireEvent.keyDown(chip, { key: 'Escape' });
    expect(document.querySelector('[data-external-sender-detail]')).toBeNull();
    fireEvent.click(chip);
    fireEvent.pointerDown(document.body);
    expect(document.querySelector('[data-external-sender-detail]')).toBeNull();
  });

  it('shows for any external one of several From addresses', () => {
    render(<ExternalSenderChip from={[{ email: 'bob@example.org' }, { email: 'eve@evil.example' }]} />);
    expect(screen.getByRole('button', { name: /evil\.example/ })).toBeTruthy();
  });

  it('shows for a From without a domain', () => {
    render(<ExternalSenderChip from={[{ email: 'ceo' }]} />);
    expect(screen.getByRole('button', { name: /sender_tooltip_no_domain/ })).toBeTruthy();
  });

  it('stays a plain label inside another button', () => {
    const { container } = render(<button type="button"><ExternalSenderChip from={[{ email: 'dave@org-two.test' }]} interactive={false} /></button>);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('[data-external-sender-chip]')?.getAttribute('title')).toBe('sender_tooltip(org-two.test)');
  });
});

describe('a message of another signed-in account (unified inbox)', () => {
  function signInDave(daveScope: Record<string, unknown> | null) {
    usePolicyStore.setState({
      rawPolicy: {
        ...DEFAULT_POLICY,
        organisation: { ...DEFAULT_ORGANISATION_POLICY, externalMail: { ...DEFAULT_ORGANISATION_POLICY.externalMail, senderLabel: true } },
        scopes: daveScope ? [{ id: 'two', label: 'Two', match: { domains: ['org-two.test'] }, policy: { organisation: { externalMail: daveScope } } }] : [],
      },
    });
    const daveClient = {
      getUsername: () => 'org-dave@org-two.test',
      getSharedAccounts: () => [],
      getAccountInfo: () => null,
      getPrincipalTypes: async () => ({}),
      getIdentities: async () => [{ id: 'd1', name: 'Dave', email: 'org-dave@org-two.test' }],
    };
    useAuthStore.setState({
      activeAccountId: 'acc-alice',
      getClientForAccount: (id: string) => (id === 'acc-dave' ? daveClient : undefined),
    } as never);
  }

  it("is judged with that account's identities", async () => {
    signInDave(null);
    // For dave, a colleague at org-two.test is internal and alice is not.
    const colleague = render(<ExternalSenderChip from={[{ email: 'colleague@org-two.test' }]} accountId="acc-dave" />);
    const alice = render(<ExternalSenderChip from={[{ email: 'alice@example.org' }]} accountId="acc-dave" />);
    await waitFor(() => expect(alice.container.querySelector('[data-external-sender-chip]')).not.toBeNull());
    expect(colleague.container.querySelector('[data-external-sender-chip]')).toBeNull();
  });

  it("follows that account's scope, not the active one's", async () => {
    signInDave({ senderLabel: false });
    const { container } = render(<ExternalSenderChip from={[{ email: 'someone@elsewhere.example' }]} accountId="acc-dave" />);
    // The active account has the label on; dave's scope turns it off.
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('[data-external-sender-chip]')).toBeNull();
    const active = render(<ExternalSenderChip from={[{ email: 'someone@elsewhere.example' }]} />);
    expect(active.container.querySelector('[data-external-sender-chip]')).not.toBeNull();
  });
});
