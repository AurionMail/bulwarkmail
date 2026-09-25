import { describe, it, expect } from 'vitest';
import { savedStatusFields } from '@/components/calendar/event-modal';
import type { CalendarEvent } from '@/lib/jmap/types';

// The event editor has no controls for status, free/busy or privacy. Saving
// used to reset every edited event to confirmed, busy and public - and on
// Stalwart 1.0 an edit of one occurrence fails when privacy differs from the
// series' (a series without CLASS has none at all).

describe('savedStatusFields', () => {
  it('gives a new event the defaults', () => {
    expect(savedStatusFields(null)).toEqual({ status: 'confirmed', freeBusyStatus: 'busy', privacy: 'public' });
  });

  it('leaves them out of an edit, keeping a tentative, free or private event as it is', () => {
    const event = { id: 'e1', status: 'tentative', freeBusyStatus: 'free', privacy: 'private' } as CalendarEvent;
    expect(savedStatusFields(event)).toEqual({});
  });
});
