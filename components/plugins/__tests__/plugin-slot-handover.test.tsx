import { render, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { usePolicyStore } from '@/stores/policy-store';
import { clearSlotOffers, offerSlots } from './fake-slot-offer';

vi.mock('@/components/plugins/plugin-iframe-slot', () => import('@/components/plugins/__tests__/fake-slot-offer'));

const { PluginSlot } = await import('../plugin-slot');

// The retired external-mail-warning plugin's banner stays away while the
// organisation's own External label or recipient warning is on, so the
// reader doesn't show both; other plugins' banners stay.

function setExternalMail(patch: Partial<typeof DEFAULT_ORGANISATION_POLICY.externalMail>) {
  usePolicyStore.setState({
    policy: {
      ...DEFAULT_POLICY,
      organisation: { ...DEFAULT_ORGANISATION_POLICY, externalMail: { ...DEFAULT_ORGANISATION_POLICY.externalMail, ...patch } },
    },
  });
}

const frames = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid="plugin-frame-email-banner"]')].map((el) => el.getAttribute('data-plugin-id'));

beforeEach(() => {
  setExternalMail({});
  offerSlots('external-mail-warning', ['email-banner']);
  offerSlots('spam-score', ['email-banner']);
});
afterEach(() => {
  cleanup();
  clearSlotOffers();
});

describe('email-banner slot while core external warnings are on', () => {
  it('shows the plugin banner while they are off and hides it as soon as one is on', () => {
    const { container } = render(<PluginSlot name="email-banner" />);
    expect(frames(container).sort()).toEqual(['external-mail-warning', 'spam-score']);
    act(() => setExternalMail({ senderLabel: true }));
    expect(frames(container)).toEqual(['spam-score']);
    act(() => setExternalMail({}));
    expect(frames(container).sort()).toEqual(['external-mail-warning', 'spam-score']);
  });
});
