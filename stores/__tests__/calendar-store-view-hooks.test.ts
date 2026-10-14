import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCalendarStore } from '../calendar-store';
import { calendarHooks, clearAllHooks } from '@/lib/plugin-hooks';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Calendar } from '@/lib/jmap/types';

// Plugins hear when the shown day or view changes, when calendars are
// created, changed, removed, shown or hidden, and when an iCal subscription
// is added, changed, removed or refreshed.

function cal(overrides: Partial<Calendar> = {}): Calendar {
  return { id: 'c1', name: 'Work', isDefault: false, ...overrides } as Calendar;
}

function fakeClient(overrides: Partial<Record<keyof IJMAPClient, unknown>> = {}) {
  return {
    createCalendar: vi.fn(async (c: Partial<Calendar>) => ({ ...c, id: 'new-cal' })),
    updateCalendar: vi.fn().mockResolvedValue(undefined),
    deleteCalendar: vi.fn().mockResolvedValue(undefined),
    setDefaultCalendar: vi.fn().mockResolvedValue(undefined),
    setCalendarShare: vi.fn().mockResolvedValue(undefined),
    getAccountId: () => 'acct',
    getCalendarsAccountId: () => 'acct',
    getServerUrl: () => 'https://mail.example',
    getUsername: () => 'me@example.com',
    getCalendars: async () => [{ id: 'sub-cal', name: 'Feed' }],
    uploadBlob: async () => ({ blobId: 'blob' }),
    parseCalendarEvents: async () => [],
    getCalendarEvents: async () => [],
    batchDeleteCalendarEvents: vi.fn(),
    ...overrides,
  } as unknown as IJMAPClient & Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => {
  clearAllHooks();
  useCalendarStore.getState().clearState();
  useCalendarStore.setState({
    calendars: [cal()], selectedCalendarIds: ['c1'], icalSubscriptions: [], error: null, dateRange: null,
    selectedDate: new Date(2026, 9, 12, 9, 0), viewMode: 'month',
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', { status: 200 })));
});

describe('date and view hooks', () => {
  it('reports a new day, but not the same day again', () => {
    const handler = vi.fn();
    calendarHooks.onCalendarDateChange.register('t', handler);
    useCalendarStore.getState().setSelectedDate(new Date(2026, 9, 12, 15, 0));
    expect(handler).not.toHaveBeenCalled();
    useCalendarStore.getState().setSelectedDate(new Date(2026, 9, 13, 9, 0));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ date: '2026-10-13' });
  });

  it('reports a new view, but not the same view again', () => {
    const handler = vi.fn();
    calendarHooks.onCalendarViewChange.register('t', handler);
    useCalendarStore.getState().setViewMode('month');
    expect(handler).not.toHaveBeenCalled();
    useCalendarStore.getState().setViewMode('week');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ view: 'week' });
  });
});

describe('calendar hooks', () => {
  it('reports created, updated and removed calendars', async () => {
    const handler = vi.fn();
    calendarHooks.onCalendarChange.register('t', handler);
    const client = fakeClient();

    await useCalendarStore.getState().createCalendar(client, { name: 'New' });
    await useCalendarStore.getState().updateCalendar(client, 'c1', { name: 'Renamed' });
    await useCalendarStore.getState().setDefaultCalendar(client, 'c1');
    await useCalendarStore.getState().removeCalendar(client, 'c1');

    expect(handler.mock.calls.map((c) => c[0])).toEqual([
      { calendarId: 'new-cal', change: 'created' },
      { calendarId: 'c1', change: 'updated' },
      { calendarId: 'c1', change: 'updated' },
      { calendarId: 'c1', change: 'removed' },
    ]);
  });

  it('does not report calendar changes the server refused', async () => {
    const handler = vi.fn();
    calendarHooks.onCalendarChange.register('t', handler);
    const fail = vi.fn().mockRejectedValue(new Error('boom'));
    const client = fakeClient({ createCalendar: fail, updateCalendar: fail, deleteCalendar: fail });

    await useCalendarStore.getState().createCalendar(client, { name: 'New' });
    await expect(useCalendarStore.getState().updateCalendar(client, 'c1', { name: 'X' })).rejects.toThrow();
    await expect(useCalendarStore.getState().removeCalendar(client, 'c1')).rejects.toThrow();

    expect(handler).not.toHaveBeenCalled();
  });

  it('reports a calendar being hidden and shown', () => {
    const handler = vi.fn();
    calendarHooks.onCalendarVisibilityToggle.register('t', handler);
    useCalendarStore.getState().toggleCalendarVisibility('c1');
    useCalendarStore.getState().toggleCalendarVisibility('c1');
    expect(handler.mock.calls.map((c) => c[0])).toEqual([
      { calendarId: 'c1', visible: false },
      { calendarId: 'c1', visible: true },
    ]);
    expect(useCalendarStore.getState().selectedCalendarIds).toEqual(['c1']);
  });
});

describe('iCal subscription hooks', () => {
  it('reports an added subscription once, without a separate refresh', async () => {
    const handler = vi.fn();
    calendarHooks.onICalSubscriptionChange.register('t', handler);
    const client = fakeClient({ createCalendar: vi.fn(async () => ({ id: 'sub-cal', name: 'Feed' })) });

    const sub = await useCalendarStore.getState().addICalSubscription(client, 'webcal://feeds.example/x.ics', 'Feed', '#f00');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ subscriptionId: sub!.id, change: 'added' });
  });

  it('does not report a subscription whose first fetch failed', async () => {
    const handler = vi.fn();
    calendarHooks.onICalSubscriptionChange.register('t', handler);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const client = fakeClient({ createCalendar: vi.fn(async () => ({ id: 'sub-cal', name: 'Feed' })) });

    await expect(useCalendarStore.getState().addICalSubscription(client, 'https://feeds.example/x.ics', 'Feed', '#f00')).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports refreshed, updated and removed subscriptions', async () => {
    const client = fakeClient();
    useCalendarStore.setState({
      calendars: [cal({ id: 'sub-cal', name: 'Feed' })],
      icalSubscriptions: [{
        id: 's1', url: 'https://feeds.example/x.ics', calendarId: 'sub-cal', accountId: 'acct',
        owner: 'https://mail.example|me@example.com', name: 'Feed', color: '#f00', refreshInterval: 60, lastRefreshed: null,
      }],
    });
    const handler = vi.fn();
    calendarHooks.onICalSubscriptionChange.register('t', handler);

    await useCalendarStore.getState().refreshICalSubscription(client, 's1');
    await useCalendarStore.getState().updateICalSubscription(client, 's1', { name: 'Renamed' });
    await useCalendarStore.getState().removeICalSubscription(client, 's1');

    expect(handler.mock.calls.map((c) => c[0])).toEqual([
      { subscriptionId: 's1', change: 'refreshed' },
      { subscriptionId: 's1', change: 'updated' },
      { subscriptionId: 's1', change: 'removed' },
    ]);
  });
});
