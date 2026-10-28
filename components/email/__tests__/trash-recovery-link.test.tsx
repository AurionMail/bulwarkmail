import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrashRecoveryLink } from '../trash-recovery-link';
import { useAuthStore } from '@/stores/auth-store';
import { usePolicyStore } from '@/stores/policy-store';
import { useRecoveryStore } from '@/stores/recovery-store';
import { jmapError } from '@/lib/jmap/jmap-error';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import type { Mailbox } from '@/lib/jmap/types';
import { LICENSE_REFUSAL } from '@/lib/recovery/__tests__/fixtures';

const push = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ stalwartFeaturesEnabled: true, isLoading: false }) }));

const TRASH = { id: 't', name: 'Trash', role: 'trash', accountId: 'ci' } as Mailbox;

function makeClient(options: { supported?: boolean; has?: boolean } = {}) {
  return {
    getAccountId: () => 'ci',
    getUsername: () => 'org-alice@example.org',
    advertisesArchivedItems: () => true,
    queryArchivedItemIds: vi.fn(async () => {
      if (options.supported === false) throw jmapError(LICENSE_REFUSAL.description, LICENSE_REFUSAL);
      return { ids: [], total: null };
    }),
    hasArchivedEmail: vi.fn(async () => options.has ?? true),
  };
}

const initialPolicy = usePolicyStore.getState();
const initialAuth = useAuthStore.getState();

function setPolicy(patch: { hidden?: boolean; days?: number } = {}) {
  const policy = {
    ...initialPolicy.policy,
    restrictions: (patch.hidden ? { deletedItemsRecovery: { hidden: true } } : {}) as Record<string, { hidden?: boolean }>,
    organisation: { ...DEFAULT_ORGANISATION_POLICY, recovery: { days: patch.days ?? 0 } },
  };
  usePolicyStore.setState({ loaded: true, rawPolicy: policy, policy, subject: { email: 'org-alice@example.org', groups: [] } });
}

async function renderLink(mailbox: Mailbox | undefined, client = makeClient()) {
  const subject = usePolicyStore.getState().subject;
  useAuthStore.setState({ client: client as never, activeAccountId: 'acc-alice' });
  usePolicyStore.setState({ subject });
  const view = render(<TrashRecoveryLink mailbox={mailbox} />);
  await act(async () => {});
  return { ...view, client };
}

beforeEach(() => setPolicy());

afterEach(() => {
  cleanup();
  push.mockReset();
  useRecoveryStore.getState().reset();
  usePolicyStore.setState(initialPolicy, true);
  useAuthStore.setState(initialAuth, true);
});

describe('TrashRecoveryLink', () => {
  it("links the account's own Trash to Recover deleted items when there is a recent message to recover", async () => {
    setPolicy({ days: 14 });
    const { client } = await renderLink(TRASH);
    expect(client.hasArchivedEmail).toHaveBeenCalledWith(undefined, { days: 14 });
    fireEvent.click(screen.getByRole('button', { name: 'trash_link' }));
    expect(push).toHaveBeenCalledWith('/settings/recovery');
  });

  it('is not there when the archive holds no message inside the days', async () => {
    const { container, client } = await renderLink(TRASH, makeClient({ has: false }));
    expect(client.hasArchivedEmail).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('is not there when the server refuses, and looks no further', async () => {
    const { container, client } = await renderLink(TRASH, makeClient({ supported: false }));
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
    expect(client.hasArchivedEmail).not.toHaveBeenCalled();
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

  it('forces the later check, so a timer that fires a little early still asks', async () => {
    useRecoveryStore.setState({ checks: { 'acc-alice|ci': { supported: false, retryAt: Date.now() + 50 } } });
    const realDetect = useRecoveryStore.getState().detect;
    const detect = vi.fn(realDetect);
    useRecoveryStore.setState({ detect });
    await renderLink(TRASH);
    await screen.findByTestId('trash-recovery-link');
    expect(detect).toHaveBeenCalledWith(expect.anything(), 'acc-alice|ci', { force: true });
    useRecoveryStore.setState({ detect: realDetect });
  });

  it('is not there when the admin hides it, and asks nothing', async () => {
    setPolicy({ hidden: true });
    const { container, client } = await renderLink(TRASH);
    expect(container).toBeEmptyDOMElement();
    expect(client.queryArchivedItemIds).not.toHaveBeenCalled();
    expect(client.hasArchivedEmail).not.toHaveBeenCalled();
  });

  it('asks nothing before the policy is loaded', async () => {
    usePolicyStore.setState({ loaded: false });
    const { container, client } = await renderLink(TRASH);
    expect(container).toBeEmptyDOMElement();
    expect(client.queryArchivedItemIds).not.toHaveBeenCalled();
  });

  it("is not there in other folders or in a shared account's Trash", async () => {
    const inbox = await renderLink({ ...TRASH, role: 'inbox' });
    expect(inbox.container).toBeEmptyDOMElement();
    expect(inbox.client.hasArchivedEmail).not.toHaveBeenCalled();
    cleanup();
    const shared = await renderLink({ ...TRASH, accountId: 'ch', isShared: true });
    expect(shared.container).toBeEmptyDOMElement();
    cleanup();
    const sharedNoAccount = await renderLink({ ...TRASH, accountId: undefined, isShared: true });
    expect(sharedNoAccount.container).toBeEmptyDOMElement();
    cleanup();
    const otherAccount = await renderLink({ ...TRASH, accountId: 'ch' });
    expect(otherAccount.container).toBeEmptyDOMElement();
  });
});
