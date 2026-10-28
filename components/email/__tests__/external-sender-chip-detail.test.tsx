import { render, fireEvent, cleanup, screen } from '@testing-library/react';
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
