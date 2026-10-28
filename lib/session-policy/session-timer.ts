/**
 * The clock behind the organisation's idle timeout and maximum session
 * length. It knows the last activity and the limits, and says when the
 * warning starts and when the session ends; the guard component
 * (components/session/session-timeout-guard.tsx) feeds it activity and
 * does the signing out.
 *
 * Deadlines are times, not countdowns: a laptop that slept through one
 * expires on the first check after waking, and activity that arrives after
 * the deadline (the focus event of the wake-up itself) can't bring the
 * session back.
 */

import type { SessionLimits } from './limits';

export type SessionEndKind = 'idle' | 'max';

export interface SessionTimerState {
  phase: 'active' | 'warning' | 'expired';
  /** Which limit the next deadline belongs to; null when no limit is set. */
  kind: SessionEndKind | null;
  /** When the session ends (ms); null when no limit is set. */
  deadline: number | null;
}

export interface SessionTimerOptions {
  limits: SessionLimits;
  lastActivity: number;
  onChange?: (state: SessionTimerState) => void;
  onExpire: (kind: SessionEndKind) => void;
  now?: () => number;
}

export interface SessionTimer {
  /** Activity in this tab. Ignored while the idle warning shows: the user answers it with "Stay signed in". */
  activity(at?: number): void;
  /** Activity in another tab, where the user may have answered the warning already. */
  remoteActivity(at: number): void;
  /** "Stay signed in": restarts the idle time, never the maximum. */
  stay(): void;
  setLimits(limits: SessionLimits): void;
  /** Look at the clock now (after a wake-up or a tab becoming visible). */
  check(): void;
  lastActivity(): number;
  state(): SessionTimerState;
  dispose(): void;
}

const MINUTE_MS = 60 * 1000;
const MAX_WAIT_MS = 60 * MINUTE_MS;

export function createSessionTimer(options: SessionTimerOptions): SessionTimer {
  const now = options.now ?? Date.now;
  let limits = options.limits;
  let lastActivity = options.lastActivity;
  let state: SessionTimerState = { phase: 'active', kind: null, deadline: null };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const publish = (next: SessionTimerState) => {
    if (next.phase === state.phase && next.kind === state.kind && next.deadline === state.deadline) return;
    state = next;
    options.onChange?.(state);
  };

  /** The deadline that comes first, with how long its warning lasts. */
  const target = (): { kind: SessionEndKind; deadline: number; warnMs: number } | null => {
    const idleMs = limits.idle ? limits.idle.minutes * MINUTE_MS : 0;
    const idle = limits.idle
      ? { kind: 'idle' as const, deadline: lastActivity + idleMs, warnMs: Math.min(limits.idle.warnSeconds * 1000, idleMs) }
      : null;
    const max = limits.max
      ? { kind: 'max' as const, deadline: limits.max.at, warnMs: limits.max.warnSeconds * 1000 }
      : null;
    if (idle && max) return max.deadline <= idle.deadline ? max : idle;
    return idle ?? max;
  };

  const evaluate = () => {
    if (disposed || state.phase === 'expired') return;
    clear();
    const next = target();
    if (!next) {
      publish({ phase: 'active', kind: null, deadline: null });
      return;
    }
    const at = now();
    if (at >= next.deadline) {
      publish({ phase: 'expired', kind: next.kind, deadline: next.deadline });
      options.onExpire(next.kind);
      return;
    }
    const warnFrom = next.deadline - next.warnMs;
    const warning = at >= warnFrom;
    publish({ phase: warning ? 'warning' : 'active', kind: next.kind, deadline: next.deadline });
    // Capped: setTimeout overflows past 24.8 days, and a long wait is checked again anyway.
    timer = setTimeout(evaluate, Math.min((warning ? next.deadline : warnFrom) - at, MAX_WAIT_MS));
  };

  const record = (at: number) => {
    // A deadline that already passed ends the session before the activity counts.
    evaluate();
    if (state.phase === 'expired') return;
    if (at > lastActivity) lastActivity = at;
    evaluate();
  };

  evaluate();

  return {
    activity(at = now()) {
      evaluate();
      if (state.phase === 'warning' && state.kind === 'idle') return;
      record(at);
    },
    remoteActivity(at) {
      record(at);
    },
    stay() {
      record(now());
    },
    setLimits(next) {
      limits = next;
      evaluate();
    },
    check: evaluate,
    lastActivity: () => lastActivity,
    state: () => state,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
