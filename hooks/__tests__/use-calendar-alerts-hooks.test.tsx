import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useCalendarAlerts } from '../use-calendar-alerts';
import { ToastContainer } from '@/components/ui/toast';
import { useAuthStore } from '@/stores/auth-store';
import { useCalendarStore } from '@/stores/calendar-store';
import { useCalendarNotificationStore } from '@/stores/calendar-notification-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useToastStore } from '@/stores/toast-store';
import { calendarHooks, clearAllHooks } from '@/lib/plugin-hooks';
import type { CalendarEvent } from '@/lib/jmap/types';

// A reminder that fires tells plugins (onCalendarAlert); the user closing
// its toast tells them it was dismissed (onCalendarAlertAcknowledge). A
// toast that just times out is not a dismissal.

const fireTime = new Date(Date.now() - 60_000).toISOString();

const event = {
  id: 'e1',
  uid: 'uid-1',
  title: 'Dentist',
  start: new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 19),
  utcStart: new Date(Date.now() + 10 * 60_000).toISOString(),
  duration: 'PT1H',
  calendarIds: { c1: true },
  useDefaultAlerts: false,
  alerts: {
    a1: { '@type': 'Alert', action: 'display', trigger: { '@type': 'AbsoluteTrigger', when: fireTime } },
  },
} as unknown as CalendarEvent;

function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  return <ToastContainer toasts={toasts} onClose={removeToast} />;
}

beforeEach(() => {
  clearAllHooks();
  useToastStore.setState({ toasts: [] });
  useCalendarNotificationStore.getState().clearAll();
  useAuthStore.setState({ isAuthenticated: true, client: null });
  useSettingsStore.setState({ calendarNotificationsEnabled: true, calendarNotificationSound: false, enableCalendarTasks: false });
  useCalendarStore.setState({ events: [event], calendars: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('reminder hooks', () => {
  it('reports a fired reminder once, and its dismissal when the user closes it', async () => {
    const fired = vi.fn();
    const acknowledged = vi.fn();
    calendarHooks.onCalendarAlert.register('t', fired);
    calendarHooks.onCalendarAlertAcknowledge.register('t', acknowledged);

    renderHook(() => useCalendarAlerts());
    render(<Toasts />);

    await waitFor(() => expect(fired).toHaveBeenCalledTimes(1));
    expect(fired).toHaveBeenCalledWith({
      id: 'a1', eventId: 'e1', eventTitle: 'Dentist', triggerTime: new Date(fireTime).toISOString(),
    });
    expect(acknowledged).not.toHaveBeenCalled();

    const close = screen.getByText('Dentist').closest('.toast-item')!.querySelector('button:last-of-type')!;
    fireEvent.click(close);
    expect(acknowledged).toHaveBeenCalledTimes(1);
    expect(acknowledged).toHaveBeenCalledWith({ alertId: 'a1', eventId: 'e1' });

    // Re-checking does not fire the same reminder again.
    act(() => { useCalendarStore.setState({ events: [{ ...event }] }); });
    expect(fired).toHaveBeenCalledTimes(1);
  });
});

describe('toast onDismiss', () => {
  it('runs when the user closes the toast, not when it times out', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toasts />);

    act(() => { useToastStore.getState().addToast({ type: 'info', title: 'Times out', duration: 1000, onDismiss }); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByText('Times out')).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => { useToastStore.getState().addToast({ type: 'info', title: 'Closed', duration: 10_000, onDismiss }); });
    const close = screen.getByText('Closed').closest('.toast-item')!.querySelector('button:last-of-type')!;
    fireEvent.click(close);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
