import { describe, expect, it } from 'vitest';
import { MAX_SKEW_MARGIN_MS, sessionLimits } from '../limits';

const HOUR = 60 * 60 * 1000;
const session = (idleMinutes: number, maxHours: number, warnSeconds = 60) => ({ idleMinutes, maxHours, warnSeconds });

describe('session limits of the signed-in accounts', () => {
  it('takes the shortest idle time that is set', () => {
    const limits = sessionLimits([
      { session: session(30, 0, 120) },
      { session: session(0, 0) },
      { session: session(10, 0, 45) },
    ]);
    expect(limits.idle).toEqual({ minutes: 10, warnSeconds: 45 });
  });

  it('ignores accounts that set nothing', () => {
    expect(sessionLimits([{ session: session(0, 0) }, { session: undefined }])).toEqual({ idle: null, max: null });
    expect(sessionLimits([])).toEqual({ idle: null, max: null });
  });

  it('ends at the first maximum that runs out, counted from each sign-in, a minute early', () => {
    const limits = sessionLimits([
      { session: session(0, 8), signedInAt: 10 * HOUR },
      { session: session(0, 12), signedInAt: 0 },
      { session: session(0, 4, 30), signedInAt: 9 * HOUR },
    ]);
    expect(limits.max).toEqual({ at: 12 * HOUR - 60 * 1000, hours: 12, warnSeconds: 60 });
    expect(MAX_SKEW_MARGIN_MS).toBe(60 * 1000);
  });

  it('needs a sign-in time to count a maximum', () => {
    expect(sessionLimits([{ session: session(0, 8) }]).max).toBeNull();
  });
});
