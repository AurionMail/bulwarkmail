import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleSendDialog } from '../schedule-send-dialog';

// Schedule send (composer) and Reschedule (Scheduled folder) pick the time in
// one dialog: a real dialog that takes the focus, keeps Tab inside and closes
// on Escape (R4), with the presets and a date-time field.

describe('ScheduleSendDialog', () => {
  it('is a dialog that closes on Escape', () => {
    const onClose = vi.fn();
    render(<ScheduleSendDialog isOpen onClose={onClose} onSchedule={vi.fn()} supported />);
    const dialog = screen.getByRole('dialog', { name: 'schedule_send' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('schedules a preset in one click', () => {
    const onSchedule = vi.fn();
    render(<ScheduleSendDialog isOpen onClose={vi.fn()} onSchedule={onSchedule} supported />);
    fireEvent.click(screen.getByText('schedule_preset.tomorrow_morning'));
    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(new Date(onSchedule.mock.calls[0][0]).getHours()).toBe(8);
  });

  it('refuses a time in the past and says why', () => {
    const onSchedule = vi.fn();
    render(<ScheduleSendDialog isOpen onClose={vi.fn()} onSchedule={onSchedule} supported title="reschedule_send" />);
    fireEvent.change(screen.getByRole('dialog').querySelector('input[type="datetime-local"]')!, { target: { value: '2020-01-01T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'reschedule_send' }));
    expect(onSchedule).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('schedule_send_future');
  });
});
