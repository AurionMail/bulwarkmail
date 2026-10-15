import { describe, it, expect } from 'vitest';
import { compareCalendars, moveCalendar, sortCalendars, sortOrderUpdates } from '../calendar-sort';
import type { Calendar } from '@/lib/jmap/types';

function cal(overrides: Partial<Calendar>): Calendar {
  return {
    id: 'c', name: 'Cal', color: null, sortOrder: 0, isSubscribed: true, isVisible: true,
    isDefault: false, includeInAvailability: 'all', timeZone: null, shareWith: null,
    myRights: null,
    ...overrides,
  } as unknown as Calendar;
}

const names = (list: Calendar[]) => list.map((c) => c.name);
const ids = (list: Calendar[]) => list.map((c) => c.id);

describe('sortCalendars', () => {
  it('orders by sortOrder, whatever order the server listed them in', () => {
    // Stalwart lists calendars in creation order.
    const list = [
      cal({ id: 'b', name: 'Default', sortOrder: 20 }),
      cal({ id: 'n', name: 'Holidays', sortOrder: 30 }),
      cal({ id: 'e', name: 'Work', sortOrder: 1 }),
      cal({ id: 'd', name: 'Personal', sortOrder: 10 }),
    ];
    expect(names(sortCalendars(list))).toEqual(['Work', 'Personal', 'Default', 'Holidays']);
  });

  it('sorts equal sortOrder by name, ignoring case and accents, numbers by value', () => {
    const list = [
      cal({ id: '1', name: 'zeta' }),
      cal({ id: '2', name: 'Team 10' }),
      cal({ id: '3', name: 'Éclair' }),
      cal({ id: '4', name: 'alpha' }),
      cal({ id: '5', name: 'Team 2' }),
      cal({ id: '6', name: 'Beta' }),
    ];
    expect(names(sortCalendars(list))).toEqual(['alpha', 'Beta', 'Éclair', 'Team 2', 'Team 10', 'zeta']);
  });

  it('treats a missing sortOrder as 0', () => {
    const list = [cal({ id: 'a', name: 'B', sortOrder: 1 }), cal({ id: 'b', name: 'A', sortOrder: undefined })];
    expect(names(sortCalendars(list))).toEqual(['A', 'B']);
  });

  it('keeps each account together, in the order the accounts came', () => {
    const list = [
      cal({ id: 'own-2', name: 'Own 2', sortOrder: 2 }),
      cal({ id: 'own-1', name: 'Own 1', sortOrder: 1 }),
      cal({ id: 'x:b', name: 'Shared B', sortOrder: 0, isShared: true, accountId: 'x' }),
      cal({ id: 'y:a', name: 'Other A', sortOrder: 0, isShared: true, accountId: 'y' }),
      cal({ id: 'x:a', name: 'Shared A', sortOrder: 5, isShared: true, accountId: 'x' }),
    ];
    expect(ids(sortCalendars(list))).toEqual(['own-1', 'own-2', 'x:b', 'x:a', 'y:a']);
  });

  it('keeps the calendars of each local account (Pro shell) together', () => {
    const list = [
      cal({ id: 'A::b', name: 'A2', sortOrder: 2, localAccountId: 'A' }),
      cal({ id: 'B::b', name: 'B1', sortOrder: 1, localAccountId: 'B' }),
      cal({ id: 'A::c', name: 'A1', sortOrder: 1, localAccountId: 'A' }),
    ];
    expect(names(sortCalendars(list))).toEqual(['A1', 'A2', 'B1']);
  });

  it('does not change the list it is given', () => {
    const list = [cal({ id: 'b', sortOrder: 2 }), cal({ id: 'a', sortOrder: 1 })];
    sortCalendars(list);
    expect(ids(list)).toEqual(['b', 'a']);
  });

  it('compareCalendars puts the lower sortOrder first', () => {
    expect(compareCalendars(cal({ sortOrder: 1, name: 'Z' }), cal({ sortOrder: 2, name: 'A' }))).toBeLessThan(0);
  });
});

describe('sortOrderUpdates', () => {
  it('numbers the calendars 1, 2, 3 in the given order and skips unchanged ones', () => {
    const list = [
      cal({ id: 'a', sortOrder: 1 }),
      cal({ id: 'b', sortOrder: 2 }),
      cal({ id: 'c', sortOrder: 3 }),
    ];
    expect(sortOrderUpdates(list, ['a', 'c', 'b'])).toEqual([
      { id: 'c', sortOrder: 2 },
      { id: 'b', sortOrder: 3 },
    ]);
  });

  it('ignores unknown ids', () => {
    expect(sortOrderUpdates([cal({ id: 'a', sortOrder: 0 })], ['a', 'gone'])).toEqual([{ id: 'a', sortOrder: 1 }]);
  });
});

describe('moveCalendar', () => {
  const list = [
    cal({ id: 'work', name: 'Work', sortOrder: 1 }),
    cal({ id: 'home', name: 'Home', sortOrder: 10 }),
    cal({ id: 'tasks', name: 'Tasks', sortOrder: 15, isTasksOnly: true }),
    cal({ id: 'holidays', name: 'Holidays', sortOrder: 30 }),
    cal({ id: 'x:team', name: 'Team', sortOrder: 0, isShared: true, accountId: 'x' }),
  ];

  it('moving up puts the calendar just before the target', () => {
    expect(moveCalendar(list, 'holidays', 'home')).toEqual(['work', 'holidays', 'home', 'tasks']);
  });

  it('moving down puts the calendar just after the target, past calendars not shown in between', () => {
    expect(moveCalendar(list, 'work', 'home')).toEqual(['home', 'work', 'tasks', 'holidays']);
  });

  it('refuses a move across accounts', () => {
    expect(moveCalendar(list, 'work', 'x:team')).toBeNull();
  });

  it('refuses unknown ids and a move onto itself', () => {
    expect(moveCalendar(list, 'work', 'gone')).toBeNull();
    expect(moveCalendar(list, 'work', 'work')).toBeNull();
  });
});
