import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionTimer, type SessionTimerState } from '../session-timer';
import type { SessionLimits } from '../limits';

const START = new Date('2026-10-28T09:00:00Z').getTime();
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const idleOnly = (minutes: number, warnSeconds: number): SessionLimits => ({ idle: { minutes, warnSeconds }, max: null });

function setup(limits: SessionLimits) {
  const states: SessionTimerState[] = [];
  const onExpire = vi.fn();
  const timer = createSessionTimer({ limits, lastActivity: Date.now(), onChange: (s) => states.push(s), onExpire });
  return { timer, states, onExpire };
}

describe('session timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns warnSeconds before the idle time runs out, then signs out at zero', () => {
    const { timer, onExpire } = setup(idleOnly(1, 30));
    expect(timer.state()).toMatchObject({ phase: 'active', kind: 'idle', deadline: START + MINUTE });

    vi.advanceTimersByTime(30 * SECOND - 1);
    expect(timer.state().phase).toBe('active');
    vi.advanceTimersByTime(1);
    expect(timer.state()).toMatchObject({ phase: 'warning', kind: 'idle', deadline: START + MINUTE });
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30 * SECOND - 1);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledWith('idle');
    expect(timer.state().phase).toBe('expired');
    timer.dispose();
  });

  it('starts the idle time again on activity before the warning', () => {
    const { timer, onExpire } = setup(idleOnly(1, 30));
    vi.advanceTimersByTime(20 * SECOND);
    timer.activity();
    // Without the reset the warning would have started at 30 s.
    vi.advanceTimersByTime(29 * SECOND);
    expect(timer.state().phase).toBe('active');
    vi.advanceTimersByTime(1 * SECOND);
    expect(timer.state().phase).toBe('warning');
    expect(timer.state().deadline).toBe(START + 20 * SECOND + MINUTE);
    vi.advanceTimersByTime(30 * SECOND);
    expect(onExpire).toHaveBeenCalledTimes(1);
    timer.dispose();
  });

  it('keeps the warning up on local activity until the user chooses to stay', () => {
    const { timer, onExpire } = setup(idleOnly(1, 30));
    vi.advanceTimersByTime(40 * SECOND);
    expect(timer.state().phase).toBe('warning');

    timer.activity();
    expect(timer.state().phase).toBe('warning');

    timer.stay();
    expect(timer.state()).toMatchObject({ phase: 'active', deadline: START + 40 * SECOND + MINUTE });
    vi.advanceTimersByTime(MINUTE - 1);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledWith('idle');
    timer.dispose();
  });

  it('ends the warning when another tab reports activity', () => {
    const { timer, onExpire } = setup(idleOnly(1, 30));
    vi.advanceTimersByTime(45 * SECOND);
    expect(timer.state().phase).toBe('warning');

    timer.remoteActivity(Date.now());
    expect(timer.state().phase).toBe('active');
    vi.advanceTimersByTime(MINUTE - 1);
    expect(onExpire).not.toHaveBeenCalled();
    timer.dispose();
  });

  it('signs out after a sleep even when the wake-up arrives as activity first', () => {
    const { timer, onExpire } = setup(idleOnly(15, 60));
    // The machine slept: the clock jumped, no timer ran.
    vi.setSystemTime(START + 2 * 60 * MINUTE);
    timer.activity();
    expect(onExpire).toHaveBeenCalledWith('idle');
    expect(timer.state().phase).toBe('expired');
    timer.remoteActivity(Date.now());
    timer.stay();
    expect(onExpire).toHaveBeenCalledTimes(1);
    timer.dispose();
  });

  it('runs no clock without limits', () => {
    const { timer, onExpire } = setup({ idle: null, max: null });
    expect(timer.state()).toEqual({ phase: 'active', kind: null, deadline: null });
    vi.advanceTimersByTime(365 * 24 * 60 * MINUTE);
    expect(onExpire).not.toHaveBeenCalled();
    timer.dispose();
  });

  it('follows new limits', () => {
    const { timer, onExpire } = setup({ idle: null, max: null });
    vi.advanceTimersByTime(10 * MINUTE);
    timer.setLimits(idleOnly(5, 60));
    // The last activity was ten minutes ago: already past five minutes.
    expect(onExpire).toHaveBeenCalledWith('idle');
    timer.dispose();
  });

  it('warns before the maximum session length and does not move it on activity', () => {
    const at = START + 2 * 60 * MINUTE;
    const { timer, onExpire } = setup({ idle: { minutes: 30, warnSeconds: 60 }, max: { at, hours: 2, warnSeconds: 60 } });

    for (let i = 0; i < 119; i++) {
      vi.advanceTimersByTime(MINUTE);
      timer.activity();
    }
    expect(timer.state()).toMatchObject({ phase: 'warning', kind: 'max', deadline: at });
    timer.stay();
    expect(timer.state()).toMatchObject({ phase: 'warning', kind: 'max' });
    vi.advanceTimersByTime(MINUTE);
    expect(onExpire).toHaveBeenCalledWith('max');
    timer.dispose();
  });

  it('counts a maximum far away without running its timer early', () => {
    const at = START + 365 * 24 * 60 * MINUTE;
    const { timer, onExpire } = setup({ idle: null, max: { at, hours: 365 * 24, warnSeconds: 60 } });
    vi.advanceTimersByTime(30 * 24 * 60 * MINUTE);
    expect(onExpire).not.toHaveBeenCalled();
    expect(timer.state().phase).toBe('active');
    timer.dispose();
  });
});
