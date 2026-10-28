import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings-store';

// The day and week views open an hour before now. Scrolled exactly to that
// hour's line, its label (centred on the line) was cut in half under the
// sticky day header on the phone.

vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timezone')>()),
  displayNow: () => new Date(2026, 9, 28, 10, 30),
}));

const { useDisplayHours } = await import('../use-display-hours');

const initial = useSettingsStore.getState();
afterEach(() => { useSettingsStore.setState(initial, true); });

describe('useDisplayHours opening scroll', () => {
  it('opens a little above the hour before now, so its label shows whole', () => {
    useSettingsStore.setState({ calendarLimitHours: true, calendarDayStartHour: 8, calendarDayEndHour: 20 } as never);
    // A pane much shorter than the hours: rows keep the minimum height.
    const pane = { scrollTop: 0, clientHeight: 300 } as unknown as HTMLElement;
    renderHook(() => useDisplayHours({ scrollRef: { current: pane }, minHourHeight: 64 }));

    const nineOClockLine = (9 - 8) * 64;
    expect(pane.scrollTop).toBeGreaterThan(0);
    // The label's top half reaches about 6px above the line.
    expect(pane.scrollTop).toBeLessThanOrEqual(nineOClockLine - 6);
    expect(pane.scrollTop).toBeGreaterThan(nineOClockLine - 32);
  });
});
