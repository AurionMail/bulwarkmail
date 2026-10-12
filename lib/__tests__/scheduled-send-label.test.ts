import { describe, expect, it } from 'vitest';
import { formatScheduledSendAt } from '../scheduled-send-label';

// Local times, so the expectations do not depend on the machine's time zone.
const at = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => new Date(y, mo - 1, d, h, mi, s);

describe('formatScheduledSendAt', () => {
  const today = at(2026, 10, 11, 18, 0);

  it('shows 08:00 for a release one second before eight', () => {
    const label = formatScheduledSendAt(at(2026, 10, 11, 19, 59, 59).toISOString(), '24h', today);
    expect(label).toContain('20:00');
    expect(label).not.toContain('19:59');
  });

  it('shows only the time for a release later today', () => {
    expect(formatScheduledSendAt(at(2026, 10, 11, 21, 30).toISOString(), '24h', today)).toBe('21:30');
  });

  it('includes the date for a release on another day', () => {
    const label = formatScheduledSendAt(at(2026, 10, 12, 7, 59, 59).toISOString(), '24h', today);
    expect(label).toContain('08:00');
    expect(label).toMatch(/12/);
  });
});
