import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendarSidebarPanel } from '../calendar-sidebar-panel';
import { useSettingsStore } from '@/stores/settings-store';
import { sharedCalendarColorKey } from '@/lib/shared-calendar-colors';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Calendar } from '@/lib/jmap/types';

// Dropping a shared calendar's own color brings back the server's color when
// it has one (#1414), so the menu says so instead of promising a random one.

const family = {
  id: 'owner:family', originalId: 'family', accountId: 'owner', isShared: true,
  name: 'Family', color: '#22c55e', colorIsLocalOverride: true, sortOrder: 0,
  isSubscribed: true, isVisible: true, isDefault: false, includeInAvailability: 'all',
  timeZone: null, shareWith: null,
  myRights: { mayReadItems: true, mayWriteAll: false, mayWriteOwn: false, mayDelete: false },
} as unknown as Calendar;

function openMenu(cal: Calendar, onResetColor: (cal: Calendar) => void) {
  const client = { getAccountId: () => 'me' } as unknown as IJMAPClient;
  render(
    <CalendarSidebarPanel
      calendars={[cal]}
      selectedCalendarIds={[cal.id]}
      onToggleVisibility={() => {}}
      onResetColor={onResetColor}
      client={client}
    />,
  );
  fireEvent.contextMenu(screen.getByTestId('calendar-item'), { clientX: 20, clientY: 20 });
}

describe('CalendarSidebarPanel shared calendar color reset', () => {
  beforeEach(() => {
    useSettingsStore.setState({ sharedCalendarColors: { [sharedCalendarColorKey(family)]: '#22c55e' } });
  });

  it('offers to reset to the server color when the server has one', async () => {
    const onResetColor = vi.fn();
    openMenu({ ...family, serverColor: '#CD1526' }, onResetColor);
    const reset = await screen.findByRole('menuitem', { name: 'reset_color' });
    expect(screen.queryByRole('menuitem', { name: 'random_color' })).toBeNull();
    fireEvent.click(reset);
    expect(onResetColor).toHaveBeenCalledTimes(1);
  });

  it('offers a new random color when the server has none', async () => {
    openMenu({ ...family, serverColor: null }, vi.fn());
    expect(await screen.findByRole('menuitem', { name: 'random_color' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'reset_color' })).toBeNull();
  });
});
