import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContactStore } from '@/stores/contact-store';
import { useCalendarStore } from '@/stores/calendar-store';
import { useAuthStore } from '@/stores/auth-store';
import { clearAllStores } from '@/lib/account-state-manager';

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// An account switch empties the account-scoped stores and bumps the store
// epoch (lib/account-state-manager.ts). The mail and filter stores drop a
// fetch that started before the switch (store-fetch-after-switch.test.ts);
// the contact and calendar stores did not, so a slow answer for account A
// became account B's contacts, address books, directory, calendars and
// events: shown in B's views, offered in B's autocomplete, acted on with B's
// client and A's ids.

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const RANGE = ['2026-10-19T00:00:00', '2026-10-26T00:00:00'] as const;

beforeEach(() => {
  clearAllStores();
  useAuthStore.setState({ activeAccountId: 'acct-A' });
});

describe('contact and calendar fetches that outlive an account switch', () => {
  it('leave B its own contacts, address books and directory', async () => {
    const gate = deferred<void>();
    const clientA = {
      getAllContacts: async () => { await gate.promise; return [{ id: 'ca', name: { full: 'A Person' } }]; },
      getAllAddressBooks: async () => { await gate.promise; return [{ id: 'ab-a', name: 'A book', accountId: 'A' }]; },
      supportsPrincipals: () => true,
      getPrincipals: async () => { await gate.promise; return [{ id: 'pa', name: 'A Principal', type: 'individual', email: 'a@a.example' }]; },
    };
    const store = useContactStore.getState();
    const inFlight = [
      store.fetchContacts(clientA as never),
      store.fetchAddressBooks(clientA as never),
      store.fetchDirectory(clientA as never),
      store.fetchAllAccountsContacts([{ client: clientA, localAccountId: 'acct-A' }] as never),
      store.fetchAllAccountsAddressBooks([{ client: clientA, localAccountId: 'acct-A' }] as never),
    ];

    // The switch: stores cleared, then B's data in place.
    clearAllStores();
    useAuthStore.setState({ activeAccountId: 'acct-B' });
    useContactStore.setState({
      contacts: [{ id: 'cb', name: { full: 'B Person' } }],
      addressBooks: [{ id: 'ab-b', name: 'B book', accountId: 'B' }],
      directoryPrincipals: [],
    } as never);

    gate.resolve();
    await Promise.all(inFlight);
    const after = useContactStore.getState();
    expect(after.contacts.map((c) => c.id)).toEqual(['cb']);
    expect(after.addressBooks.map((b) => b.id)).toEqual(['ab-b']);
    expect(after.directoryPrincipals).toEqual([]);
  });

  it('leave B its own calendars and events', async () => {
    const gate = deferred<void>();
    const clientA = {
      getAllCalendarsWithFailures: async () => {
        await gate.promise;
        return { calendars: [{ id: 'cal-a', name: 'A cal', accountId: 'A', isVisible: true }], failedAccountIds: [] };
      },
      queryAllCalendarEvents: async () => {
        await gate.promise;
        return [{ id: 'ev-a', calendarIds: { 'cal-a': true }, title: 'A event', start: '2026-10-20T10:00:00', duration: 'PT1H' }];
      },
      getPrincipals: async () => [],
      supportsPrincipals: () => false,
      getCalendarAccounts: () => [],
      getAccountId: () => 'A',
      getParticipantIdentities: async () => [],
    };
    const store = useCalendarStore.getState();
    const inFlight = [
      store.fetchCalendars(clientA as never),
      store.fetchEvents(clientA as never, ...RANGE),
      store.fetchAllAccountsCalendars([{ client: clientA, localAccountId: 'acct-A' }] as never),
      store.fetchAllAccountsEvents([{ client: clientA, localAccountId: 'acct-A' }] as never, ...RANGE),
    ];

    clearAllStores();
    useAuthStore.setState({ activeAccountId: 'acct-B' });
    useCalendarStore.setState({
      calendars: [{ id: 'cal-b', name: 'B cal', accountId: 'B', isVisible: true }],
      events: [{ id: 'ev-b', calendarIds: { 'cal-b': true }, title: 'B event', start: '2026-10-21T10:00:00', duration: 'PT1H' }],
    } as never);

    gate.resolve();
    await Promise.all(inFlight);
    const after = useCalendarStore.getState();
    expect(after.calendars.map((c) => c.id)).toEqual(['cal-b']);
    expect(after.events.map((e) => e.id)).toEqual(['ev-b']);
  });

  it('still store the answer when no switch happened', async () => {
    const client = {
      getAllContacts: async () => [{ id: 'c1', name: { full: 'Person' } }],
      getAllAddressBooks: async () => [{ id: 'ab', name: 'Book', accountId: 'A' }],
      getAllCalendarsWithFailures: async () => ({ calendars: [{ id: 'cal', name: 'Cal', accountId: 'A', isVisible: true }], failedAccountIds: [] }),
      queryAllCalendarEvents: async () => [{ id: 'ev', calendarIds: { cal: true }, title: 'Event', start: '2026-10-20T10:00:00', duration: 'PT1H' }],
      getParticipantIdentities: async () => [],
    };
    await useContactStore.getState().fetchContacts(client as never);
    await useContactStore.getState().fetchAddressBooks(client as never);
    await useCalendarStore.getState().fetchCalendars(client as never);
    await useCalendarStore.getState().fetchEvents(client as never, ...RANGE);
    expect(useContactStore.getState().contacts.map((c) => c.id)).toEqual(['c1']);
    expect(useContactStore.getState().addressBooks.map((b) => b.id)).toEqual(['ab']);
    expect(useCalendarStore.getState().calendars.map((c) => c.id)).toEqual(['cal']);
    expect(useCalendarStore.getState().events.map((e) => e.id)).toEqual(['ev']);
  });
});
