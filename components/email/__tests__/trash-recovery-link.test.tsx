import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrashRecoveryLink } from '../trash-recovery-link';
import { useAuthStore } from '@/stores/auth-store';
import { usePolicyStore } from '@/stores/policy-store';
import { useRecoveryStore } from '@/stores/recovery-store';
import { jmapError } from '@/lib/jmap/jmap-error';
import type { Mailbox } from '@/lib/jmap/types';
import { LICENSE_REFUSAL } from '@/lib/recovery/__tests__/fixtures';

const push = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ stalwartFeaturesEnabled: true }) }));

const TRASH = { id: 't', name: 'Trash', role: 'trash', accountId: 'ci' } as Mailbox;

function makeClient(supported = true) {
  return {
    getAccountId: () => 'ci',
    advertisesArchivedItems: () => true,
    queryArchivedItemIds: vi.fn(async () => {
      if (!supported) throw jmapError(LICENSE_REFUSAL.description, LICENSE_REFUSAL);
      return [];
    }),
  };
}

const initialPolicy = usePolicyStore.getState();
const initialAuth = useAuthStore.getState();

async function renderLink(mailbox: Mailbox | undefined, client = makeClient()) {
  useAuthStore.setState({ client: client as never, activeAccountId: 'acc-alice' });
  const view = render(<TrashRecoveryLink mailbox={mailbox} />);
  await act(async () => {});
  return { ...view, client };
}

afterEach(() => {
  cleanup();
  push.mockReset();
  useRecoveryStore.getState().reset();
  usePolicyStore.setState(initialPolicy, true);
  useAuthStore.setState(initialAuth, true);
});

describe('TrashRecoveryLink', () => {
  it("links the account's own Trash to Recover deleted items when the server offers it", async () => {
    await renderLink(TRASH);
    fireEvent.click(screen.getByRole('button', { name: 'trash_link' }));
    expect(push).toHaveBeenCalledWith('/settings/recovery');
  });

  it('is not there when the server refuses', async () => {
    const { container, client } = await renderLink(TRASH, makeClient(false));
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('appears once a later check finds the license, while Trash stays open', async () => {
    // An earlier refusal, due to be asked again shortly.
    useRecoveryStore.setState({ checks: { 'acc-alice|ci': { supported: false, retryAt: Date.now() + 50 } } });
    const { client } = await renderLink(TRASH);
    expect(screen.queryByTestId('trash-recovery-link')).toBeNull();
    expect(client.queryArchivedItemIds).not.toHaveBeenCalled();
    expect(await screen.findByTestId('trash-recovery-link')).toBeTruthy();
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
  });

  it('is not there when the admin hides it, and asks nothing', async () => {
    usePolicyStore.setState((s) => ({ policy: { ...s.policy, restrictions: { ...s.policy.restrictions, deletedItemsRecovery: { hidden: true } } } }));
    const { container, client } = await renderLink(TRASH);
    expect(container).toBeEmptyDOMElement();
    expect(client.queryArchivedItemIds).not.toHaveBeenCalled();
  });

  it("is not there in other folders or in a shared account's Trash", async () => {
    const inbox = await renderLink({ ...TRASH, role: 'inbox' });
    expect(inbox.container).toBeEmptyDOMElement();
    cleanup();
    const shared = await renderLink({ ...TRASH, accountId: 'ch', isShared: true });
    expect(shared.container).toBeEmptyDOMElement();
  });
});
