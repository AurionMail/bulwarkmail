import { describe, it, expect } from 'vitest';
import { alertRowsOf, buildAlertsPatch, type AlertRow } from '@/components/calendar/event-modal';
import type { CalendarEvent, CalendarEventAlert } from '@/lib/jmap/types';

// What the event editor saves for the alerts. It used to rename every alert
// to alert1..N and send them on every save. On Stalwart 1.0 that loses alert
// edits on events that use their calendar's default alerts:
// - on get, while `useDefaultAlerts` is on, the server shows the calendar's
//   defaults in `alerts` (under the default alerts' ids) instead of the
//   event's own (calendar_event/get.rs, DefaultAlertsView::Replace);
// - on save, it drops every alert whose id is a default id
//   (calendar_event/set.rs, strip_default_alerts).
// 0.16 copied the defaults into the event once, at create, and stores
// whatever is sent.

const offsetAlert = (offset: string, extra: Partial<CalendarEventAlert> = {}): CalendarEventAlert => ({
  '@type': 'Alert',
  trigger: { '@type': 'OffsetTrigger', offset, relativeTo: 'start' },
  action: 'display',
  acknowledged: null,
  relatedTo: null,
  ...extra,
});

type Stored = { own: Record<string, CalendarEventAlert>; useDefaultAlerts: boolean };
type Patch = Partial<Pick<CalendarEvent, 'alerts' | 'useDefaultAlerts'>>;

const DEFAULTS = { 'default-15': offsetAlert('-PT15M') };

/** What Stalwart 1.0 answers for the event's alerts. */
function get10(stored: Stored): Pick<CalendarEvent, 'alerts' | 'useDefaultAlerts'> {
  return { useDefaultAlerts: stored.useDefaultAlerts, alerts: stored.useDefaultAlerts ? { ...DEFAULTS } : { ...stored.own } };
}

/** How Stalwart 1.0 stores an update of the event's alerts. */
function update10(stored: Stored, patch: Patch): Stored {
  const viewDefaults: Record<string, CalendarEventAlert> = stored.useDefaultAlerts ? DEFAULTS : {};
  let alerts = { ...stored.own, ...viewDefaults };
  if ('alerts' in patch) alerts = { ...(patch.alerts ?? {}) };
  const useDefaultAlerts = 'useDefaultAlerts' in patch ? !!patch.useDefaultAlerts : stored.useDefaultAlerts;
  const newDefaults: Record<string, CalendarEventAlert> = useDefaultAlerts ? DEFAULTS : {};
  for (const id of Object.keys(alerts)) {
    if (id in viewDefaults || id in newDefaults) delete alerts[id];
  }
  return { own: alerts, useDefaultAlerts };
}

const offsets = (alerts: CalendarEvent['alerts']) => Object.values(alerts ?? {})
  .map((a) => (a.trigger as { offset: string }).offset)
  .sort();

/** The editor's rows for `alerts`, with `edit` applied to them. */
function edit(event: Pick<CalendarEvent, 'alerts' | 'useDefaultAlerts'>, change: (rows: AlertRow[]) => AlertRow[]): Patch {
  const { rows, preserved } = alertRowsOf(event.alerts);
  return buildAlertsPatch(event, change(rows), preserved, Object.keys(DEFAULTS));
}

const newRow = (value: number, unit: AlertRow['unit']): AlertRow => ({ id: `new-${value}-${unit}`, value, unit, action: 'display' });

describe('saving the alerts of an event that uses its calendar’s default alerts', () => {
  it('keeps the defaults as alerts of its own when the user customizes them unchanged, on Stalwart 1.0', () => {
    // The editor saves through the rows only after "Customize"; untouched,
    // the event stays on its calendar's defaults.
    let stored: Stored = { own: {}, useDefaultAlerts: true };
    const patch = edit(get10(stored), (rows) => rows);

    expect(patch.useDefaultAlerts).toBe(false);
    expect(Object.keys(patch.alerts ?? {})).not.toContain('default-15');
    stored = update10(stored, patch);
    expect(offsets(get10(stored).alerts)).toEqual(['-PT15M']);
  });

  it('keeps a changed alert on Stalwart 1.0 by turning the defaults off', () => {
    let stored: Stored = { own: {}, useDefaultAlerts: true };
    const patch = edit(get10(stored), ([row]) => [{ ...row, value: 30 }]);

    expect(patch.useDefaultAlerts).toBe(false);
    stored = update10(stored, patch);
    expect(offsets(get10(stored).alerts)).toEqual(['-PT30M']);

    // What was sent before: the same alerts renamed, with the defaults left
    // on. Stalwart 1.0 keeps showing the defaults instead.
    const before = update10({ own: {}, useDefaultAlerts: true }, { alerts: { alert1: offsetAlert('-PT30M') } });
    expect(offsets(get10(before).alerts)).toEqual(['-PT15M']);
  });

  it('keeps an untouched default next to a new alert on Stalwart 1.0, under ids of their own', () => {
    let stored: Stored = { own: {}, useDefaultAlerts: true };
    const patch = edit(get10(stored), (rows) => [...rows, newRow(1, 'hours')]);

    expect(Object.keys(patch.alerts ?? {})).not.toContain('default-15');
    stored = update10(stored, patch);
    expect(offsets(get10(stored).alerts)).toEqual(['-PT15M', '-PT1H']);
  });

  it('removes every alert on Stalwart 1.0 when the user removes them', () => {
    let stored: Stored = { own: {}, useDefaultAlerts: true };
    const patch = edit(get10(stored), () => []);

    expect(patch).toEqual({ alerts: null, useDefaultAlerts: false });
    stored = update10(stored, patch);
    expect(get10(stored).alerts).toEqual({});
  });

  it('turns the defaults off on 0.16 too, where the event holds its own copy of them', () => {
    // 0.16 copied the calendar's defaults into the event at create time.
    const event = { useDefaultAlerts: true, alerts: { copied: offsetAlert('-PT15M') } };
    const patch = edit(event, ([row]) => [{ ...row, value: 45 }]);

    expect(patch).toEqual({ useDefaultAlerts: false, alerts: { alert1: offsetAlert('-PT45M') } });
  });
});

describe('saving the alerts of an event with alerts of its own', () => {
  const event = {
    useDefaultAlerts: false,
    alerts: {
      a1: offsetAlert('-PT15M'),
      // Before the end, which the editor cannot show exactly.
      a2: offsetAlert('PT10M', { trigger: { '@type': 'OffsetTrigger', offset: '-PT10M', relativeTo: 'end' } }),
      abs: { ...offsetAlert('-PT1H'), trigger: { '@type': 'AbsoluteTrigger', when: '2026-09-10T08:00:00Z' } },
    } as Record<string, CalendarEventAlert>,
  };

  it('sends nothing when they were not touched', () => {
    expect(edit(event, (rows) => rows)).toEqual({});
  });

  it('keeps untouched alerts as they were, under their ids, and adds new ones under new ids', () => {
    const patch = edit(event, (rows) => [...rows, newRow(2, 'days')]);

    expect(patch).not.toHaveProperty('useDefaultAlerts');
    expect(patch.alerts).toEqual({
      a1: event.alerts.a1,
      a2: event.alerts.a2,
      abs: event.alerts.abs,
      alert1: offsetAlert('-P2D'),
    });
  });

  it('sends the remaining alerts when one is removed, and null when all are', () => {
    expect(edit(event, (rows) => rows.filter((row) => row.source?.alertId !== 'a1')).alerts)
      .toEqual({ a2: event.alerts.a2, abs: event.alerts.abs });
    const onlyRows = { useDefaultAlerts: false, alerts: { a1: offsetAlert('-PT15M') } };
    expect(edit(onlyRows, () => [])).toEqual({ alerts: null });
  });
});

describe('saving the alerts of a new event', () => {
  it('sends the rows as new alerts and turns the calendar defaults off', () => {
    expect(buildAlertsPatch(null, [newRow(10, 'minutes')], {}))
      .toEqual({ useDefaultAlerts: false, alerts: { alert1: offsetAlert('-PT10M') } });
    expect(buildAlertsPatch(null, [], {})).toEqual({ useDefaultAlerts: false });
  });
});
