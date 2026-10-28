import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CalendarToolbar } from '../calendar-toolbar';

// The phone day view's title was cut to "Th…": the long date beside the
// menu, the back arrow, both chevrons, Today and the header buttons.

vi.mock('@/components/layout/phone-header-actions', () => ({ PhoneHeaderActions: () => null }));

function renderToolbar(overrides: Partial<React.ComponentProps<typeof CalendarToolbar>> = {}) {
  render(
    <CalendarToolbar
      selectedDate={new Date(2026, 9, 28)}
      viewMode="day"
      onPrev={vi.fn()}
      onNext={vi.fn()}
      onToday={vi.fn()}
      onViewModeChange={vi.fn()}
      onCreateEvent={vi.fn()}
      isMobile
      onMenuClick={vi.fn()}
      {...overrides}
    />,
  );
}

describe('phone toolbar in the day view', () => {
  it('names the day short, with the full date as its tooltip', () => {
    renderToolbar();
    const title = screen.getByText('Oct 28');
    expect(title).toHaveAttribute('title', 'Wednesday, October 28, 2026');
  });

  it('puts the way back to the month in the menu button\'s place', () => {
    renderToolbar({ onNavigateBack: vi.fn() });
    expect(screen.getByRole('button', { name: 'back_to_month' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'nav_open_menu' })).toBeNull();
  });

  it('keeps the menu when there is no way back', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: 'nav_open_menu' })).toBeInTheDocument();
  });
});
