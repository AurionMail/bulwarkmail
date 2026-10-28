import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareCollectionDialog } from '../share-collection-dialog';
import { MailboxShareDialog } from '@/components/layout/mailbox-share-dialog';
import { usePolicyStore } from '@/stores/policy-store';
import { presetRights, type AnyRights, type ShareKind } from '@/lib/jmap/share-rights';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Mailbox } from '@/lib/jmap/types';

// The admin's `sharingRights` without "write": every share dialog offers
// the read presets only, and a grant that already gives more stays named but
// can't be picked again.

const initialPolicy = usePolicyStore.getState();
afterEach(() => usePolicyStore.setState(initialPolicy, true));

function readOnly() {
  usePolicyStore.setState((state) => ({ policy: { ...state.policy, restrictions: { ...state.policy.restrictions, sharingRights: { allowedValues: ['read'] } } } }));
}

const client = {
  getAccountId: () => 'me',
  listPrincipals: vi.fn(async () => ({ principals: [], status: 'ok' as const })),
  getPrincipals: vi.fn(async () => []),
} as unknown as IJMAPClient;

function renderKind(kind: ShareKind, shareWith: Record<string, AnyRights>) {
  const onShare = vi.fn().mockResolvedValue(undefined);
  render(<ShareCollectionDialog client={client} kind={kind} collectionName="X" shareWith={shareWith} ownAccountId="me" onShare={onShare} onClose={vi.fn()} />);
  return onShare;
}

const offered = (select: HTMLElement) => within(select).getAllByRole('option')
  .filter((o) => !(o as HTMLOptionElement).disabled)
  .map((o) => (o as HTMLOptionElement).value);

describe('sharingRights in the share dialogs', () => {
  it.each([
    ['mailbox', ['read', 'readWrite', 'manager']],
    ['calendar', ['freeBusy', 'read', 'readWrite', 'manager']],
    ['addressBook', ['read', 'readWrite', 'manager']],
    ['file', ['read', 'readWrite', 'manager']],
  ] as const)('offers every preset for a %s without a restriction', (kind, all) => {
    renderKind(kind, { anna: presetRights(kind, 'read')! });
    expect(offered(screen.getByRole('combobox'))).toEqual(all);
    expect(screen.queryByText('org_locked')).toBeNull();
  });

  it.each([
    ['mailbox', ['read']],
    ['calendar', ['freeBusy', 'read']],
    ['addressBook', ['read']],
    ['file', ['read']],
  ] as const)('offers only read presets for a %s without write, and says why', (kind, readOnlyPresets) => {
    readOnly();
    renderKind(kind, { anna: presetRights(kind, 'read')! });
    expect(offered(screen.getByRole('combobox'))).toEqual(readOnlyPresets);
    expect(screen.getByText('org_locked')).toBeInTheDocument();
  });

  it('keeps an existing write grant named but not pickable, and refuses to give write', async () => {
    readOnly();
    const onShare = renderKind('mailbox', { anna: presetRights('mailbox', 'readWrite')! });
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('readWrite');
    expect((within(select).getByRole('option', { name: 'preset.readWrite' }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(select, { target: { value: 'manager' } });
    await act(async () => {});
    expect(onShare).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: 'read' } });
    await waitFor(() => expect(onShare).toHaveBeenCalledWith('anna', presetRights('mailbox', 'read')));
  });

  it('applies to the folder share dialog', async () => {
    readOnly();
    const mailboxClient = {
      ...client,
      getMailboxShareWith: vi.fn(async () => ({ anna: presetRights('mailbox', 'read') })),
      setMailboxShare: vi.fn(async () => {}),
    } as unknown as IJMAPClient;
    render(<MailboxShareDialog client={mailboxClient} mailbox={{ id: 'a', name: 'Inbox', role: 'inbox' } as Mailbox} onClose={vi.fn()} />);
    const select = await screen.findByRole('combobox');
    expect(offered(select)).toEqual(['read']);
  });
});
