import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';
import { useCalendarStore } from '@/stores/calendar-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useToastStore } from '@/stores/toast-store';

// The whole calendar page, with the shell around it stubbed out and the
// stores holding a fixed set of calendars and events.

const media = vi.hoisted(() => ({ mobile: false, desktop: true }));
vi.mock('@/hooks/use-media-query', () => ({
  useIsMobile: () => media.mobile,
  useIsDesktop: () => media.desktop,
  useIsTablet: () => !media.mobile && !media.desktop,
  useMediaQuery: () => false,
}));
vi.mock('@/components/layout/navigation-rail', () => ({ NavigationRail: () => null }));
vi.mock('@/components/layout/sidebar-apps-modal', () => ({ SidebarAppsModal: () => null }));
vi.mock('@/components/layout/inline-app-view', () => ({ InlineAppView: () => null }));
vi.mock('@/components/layout/mv-top-bar', () => ({ MvTopBar: () => null }));
vi.mock('@/components/plugins/app-top-banner-slot', () => ({ AppTopBannerSlot: () => null }));
vi.mock('@/hooks/use-refresh-gesture', () => ({ useRefreshGesture: () => ({ indicator: null }) }));
vi.mock('@/hooks/use-calendar-push-refresh', () => ({ useCalendarPushRefresh: () => {} }));
vi.mock('@/hooks/use-account-principal-emails', () => ({ useAccountPrincipalEmails: () => [] }));
vi.mock('../participant-availability', () => ({ ParticipantAvailability: () => null }));

import { CalendarApp } from '../calendar-app';

// The first render loads the whole page and is slow under load.
vi.setConfig({ testTimeout: 30000 });

const RIGHTS = {
  mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true,
  mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true,
};

const calendars = [{
  id: 'cal', name: 'Personal', color: '#123456', isDefault: true, sortOrder: 0, description: null,
  isSubscribed: true, isVisible: true, includeInAvailability: 'all', defaultAlertsWithTime: null,
  defaultAlertsWithoutTime: null, timeZone: null, shareWith: null, myRights: RIGHTS,
}] as unknown as Calendar[];

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e1', uid: 'u1', '@type': 'Event', title: 'Standup', description: '', start: '2026-10-12T10:00:00',
    duration: 'PT1H', timeZone: null, showWithoutTime: false, calendarIds: { cal: true },
    participants: null, alerts: null, recurrenceRules: null, isOrigin: true, status: 'confirmed',
    ...overrides,
  } as unknown as CalendarEvent;
}

const client = {
  getAccountId: () => 'acc',
  getMaxParticipantsPerEvent: () => null,
  supportsCalendars: () => true,
  queryCalendarEvents: vi.fn().mockResolvedValue([]),
  getCalendarEvent: vi.fn().mockResolvedValue(null),
  getCalendarTasks: vi.fn().mockResolvedValue([]),
};

const store = {
  fetchCalendars: vi.fn(),
  fetchEvents: vi.fn(),
  refreshAllSubscriptions: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  rsvpEvent: vi.fn(),
};

function setUp(events: CalendarEvent[] = [makeEvent()], viewMode: 'month' | 'week' | 'day' | 'agenda' | 'tasks' = 'week') {
  for (const fn of Object.values(store)) fn.mockReset();
  store.createEvent.mockImplementation(async (_c: unknown, data: Partial<CalendarEvent>) => ({ ...makeEvent(), ...data, id: 'new' }));
  store.updateEvent.mockResolvedValue(true);
  store.deleteEvent.mockResolvedValue(true);
  useAuthStore.setState({ isAuthenticated: true, client: client as never, isLoading: false, activeAccountId: 'acc' });
  useCalendarStore.setState({
    calendars, events, supportsCalendar: true, selectedCalendarIds: ['cal'], viewMode,
    selectedDate: new Date(2026, 9, 12), isLoading: false, isLoadingEvents: false, error: null,
    ...store,
  } as never);
  useSettingsStore.setState({ calendarHoverPreview: 'instant', enableCalendarTasks: true, proInterface: false } as never);
  useToastStore.setState({ toasts: [] } as never);
}

function renderApp() {
  return render(<CalendarApp />);
}

beforeEach(() => {
  media.mobile = false;
  media.desktop = true;
  setUp();
});

describe('CalendarApp keyboard shortcuts', () => {
  it('leaves Ctrl, Cmd and Alt combinations to the browser', () => {
    renderApp();
    fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'd', code: 'KeyD', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    expect(useCalendarStore.getState().viewMode).toBe('week');
    expect(useCalendarStore.getState().selectedDate).toEqual(new Date(2026, 9, 12));
  });

  it('switches views by the physical key on any layout', () => {
    renderApp();
    // A Cyrillic layout types "ф" on the A key.
    fireEvent.keyDown(document.body, { key: 'ф', code: 'KeyA' });
    expect(useCalendarStore.getState().viewMode).toBe('agenda');
  });

  it('keeps working while the hover preview of an event shows', async () => {
    renderApp();
    const card = screen.getAllByRole('button', { name: /Standup/ })[0];
    fireEvent.mouseEnter(card);
    await screen.findByRole('dialog', { name: 'Standup' });
    fireEvent.keyDown(document.body, { key: 'm', code: 'KeyM' });
    expect(useCalendarStore.getState().viewMode).toBe('month');
  });
});

