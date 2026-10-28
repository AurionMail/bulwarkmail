import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Calendar } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// The event editor opened with the focus on its close button, so typing
// went nowhere; the import, subscription and new-calendar dialogs were
// hand-rolled: Escape only worked from some places and no focus handling.

vi.mock('../participant-availability', () => ({ ParticipantAvailability: () => null }));

import { EventModal } from '../event-modal';
import { ICalImportModal } from '../ical-import-modal';
import { ICalSubscriptionModal } from '../ical-subscription-modal';
import { CreateCalendarModal } from '../create-calendar-modal';

const calendars = [{
  id: 'cal', name: 'Personal', color: '#123456', isDefault: true,
  myRights: { mayReadItems: true, mayWriteAll: true, mayWriteOwn: true, mayDelete: true },
}] as unknown as Calendar[];
const client = { getAccountId: () => 'acct' } as unknown as IJMAPClient;

describe('calendar dialogs', () => {
  it('opens a new event with the cursor in Title', () => {
    render(<EventModal calendars={calendars} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByPlaceholderText('form.title'));
  });

  it('closes the import dialog with Escape, wherever the focus is', () => {
    const onClose = vi.fn();
    render(<ICalImportModal calendars={calendars} client={client} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the subscription dialog in the address field, with a named close button', () => {
    const onClose = vi.fn();
    render(<ICalSubscriptionModal client={client} onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByLabelText('url_label'));
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the new-calendar dialog in the name field and keeps typed input on an outside click', () => {
    const onClose = vi.fn();
    render(<CreateCalendarModal client={client} onClose={onClose} />);
    const name = screen.getByLabelText('name');
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: 'Gym' } });
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });
});
