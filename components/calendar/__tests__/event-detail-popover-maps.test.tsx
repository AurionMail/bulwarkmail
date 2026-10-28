import { render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { EventDetailPopover } from '../event-detail-popover';
import { setNoThirdPartyTraffic } from '@/lib/third-party-mode';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

// #903: an address opens Google Maps only while third-party traffic is allowed.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
  useFormatter: () => ({ dateTime: (d: Date | string) => String(d), relativeTime: (d: Date | string) => String(d), number: (n: number) => String(n) }),
}));

const calendar = { id: 'cal-1', name: 'Work', myRights: { mayWriteAll: true, mayWriteOwn: true } } as unknown as Calendar;

function renderPopover() {
  const event = {
    id: 'evt-1', calendarIds: { 'cal-1': true }, title: 'Visit', start: '2026-11-20T10:00:00', duration: 'PT1H',
    timeZone: 'Europe/Berlin', showWithoutTime: false, participants: null, alerts: null, useDefaultAlerts: false,
    locations: { l1: { name: 'Hauptstrasse 1, Berlin' } },
  } as unknown as CalendarEvent;
  render(
    <EventDetailPopover event={event} calendar={calendar} anchorRect={new DOMRect(100, 100, 50, 20)}
      onEdit={vi.fn()} onDelete={vi.fn()} onDuplicate={vi.fn()} onClose={vi.fn()} onSaveNote={vi.fn()} />,
  );
  return screen.getByTitle('Hauptstrasse 1, Berlin');
}

afterEach(() => setNoThirdPartyTraffic(false));

describe('event address link', () => {
  it('opens Google Maps with third-party traffic allowed', () => {
    expect(renderPopover().getAttribute('href')).toMatch(/^https:\/\/www\.google\.com\/maps\//);
  });

  it('is plain text with no third-party traffic', () => {
    setNoThirdPartyTraffic(true);
    expect(renderPopover().getAttribute('href')).toBeNull();
  });

  it('is plain text while the config is still unknown', () => {
    setNoThirdPartyTraffic('unknown');
    expect(renderPopover().getAttribute('href')).toBeNull();
  });
});
