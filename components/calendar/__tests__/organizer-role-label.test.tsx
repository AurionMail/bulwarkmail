import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';
import de from '@/locales/de/common.json';

// The organizer's mark in an event's participants was the "Organizer"
// label lowercased in code, which made the German noun "(organisator)".
// Each language now says how it writes the role inside a sentence.

vi.mock('next-intl', () => {
  const lookup = (path: string): unknown => path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], de);
  return {
    useTranslations: (ns?: string) => {
      const t = (key: string, values?: Record<string, unknown>) => {
        const found = lookup(ns ? `${ns}.${key}` : key);
        if (typeof found !== 'string') return key;
        return found.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
      };
      return Object.assign(t, { has: (key: string) => typeof lookup(ns ? `${ns}.${key}` : key) === 'string', rich: t, raw: t });
    },
    useLocale: () => 'de',
    useFormatter: () => ({ dateTime: String, relativeTime: String, number: String }),
  };
});
vi.mock('../participant-availability', () => ({ ParticipantAvailability: () => null }));

const { EventModal } = await import('../event-modal');

const calendars = [{
  id: 'cal', name: 'Personal', color: '#123456', isDefault: true,
  myRights: {
    mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true,
    mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true,
  },
}] as unknown as Calendar[];

const person = (address: string, owner: boolean) => ({
  '@type': 'Participant', calendarAddress: `mailto:${address}`, email: address, name: address.split('@')[0],
  roles: owner ? { owner: true } : { attendee: true }, participationStatus: 'accepted', kind: 'individual',
});

const lunch = {
  id: 'e1', uid: 'u1', '@type': 'Event', title: 'Lunch', description: '', start: '2026-10-28T12:30:00',
  duration: 'PT1H', timeZone: 'Europe/Berlin', showWithoutTime: false, calendarIds: { cal: true },
  organizerCalendarAddress: 'mailto:nora@example.com',
  participants: { nora: person('nora@example.com', true), sarah: person('sarah@example.com', false) },
  alerts: null, recurrenceRules: null,
} as unknown as CalendarEvent;

describe('organizer mark in German', () => {
  it('keeps the noun capitalised', () => {
    render(<EventModal event={lunch} calendars={calendars} onSave={vi.fn()} onClose={vi.fn()} currentUserEmails={['me@example.com']} />);
    expect(screen.getByText('(Organisator)')).toBeInTheDocument();
    expect(screen.queryByText('(organisator)')).toBeNull();
  });
});
