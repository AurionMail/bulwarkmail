"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { useAccountStore } from "@/stores/account-store";
import { usePolicyStore } from "@/stores/policy-store";
import { policySubjectForClient } from "@/lib/admin/policy-subject";
import type { PolicySubject } from "@/lib/admin/policy-scopes";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import { flushComposers } from "@/lib/compose-flush-registry";
import { openActivityChannel, readLastActivity, type ActivityChannel } from "@/lib/session-policy/activity-channel";
import {
  NO_SESSION_LIMITS,
  sameLimits,
  sessionLimits,
  setCurrentSessionLimits,
  type AccountSession,
  type SessionLimits,
} from "@/lib/session-policy/limits";
import { createSessionTimer, type SessionEndKind, type SessionTimer, type SessionTimerState } from "@/lib/session-policy/session-timer";
import { rememberSessionEnd } from "@/lib/session-policy/sign-out-reason";
import { SessionTimeoutDialog } from "./session-timeout-dialog";

/** How long the sign-out waits for the open composers to save their drafts. */
export const DRAFT_FLUSH_TIMEOUT_MS = 8000;
/** Local activity reaches the timer and the other tabs at most this often. */
const ACTIVITY_THROTTLE_MS = 1000;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel", "scroll", "focus"] as const;

const subjects = new WeakMap<IJMAPClient, Promise<PolicySubject | null>>();
function subjectFor(client: IJMAPClient): Promise<PolicySubject | null> {
  let subject = subjects.get(client);
  if (!subject) {
    subject = policySubjectForClient(client).catch(() => null);
    subjects.set(client, subject);
  }
  return subject;
}

/** The limits of every account signed in here, each with its own domain and group scopes. */
async function collectLimits(): Promise<SessionLimits> {
  const auth = useAuthStore.getState();
  const clients = new Map<string, IJMAPClient>(auth.getAllConnectedClients());
  if (auth.client && auth.activeAccountId && !clients.has(auth.activeAccountId)) clients.set(auth.activeAccountId, auth.client);
  const accounts: AccountSession[] = await Promise.all([...clients.entries()].map(async ([accountId, client]) => {
    const subject = await subjectFor(client);
    const session = usePolicyStore.getState().resolveFor(subject).organisation?.session;
    return { session, signedInAt: signedInAtFor(accountId) };
  }));
  return sessionLimits(accounts);
}

/**
 * When the account signed in. An account signed in before this was recorded
 * counts as signed in now, the first time it is seen.
 */
function signedInAtFor(accountId: string): number | undefined {
  const store = useAccountStore.getState();
  const account = store.getAccountById(accountId);
  if (!account) return undefined;
  if (typeof account.signedInAt === "number") return account.signedInAt;
  const now = Date.now();
  store.updateAccount(accountId, { signedInAt: now });
  return now;
}

const IDLE_STATE: SessionTimerState = { phase: "active", kind: null, deadline: null };

/**
 * The organisation's idle timeout and maximum session length
 * (policy.json `organisation.session`). Activity in any Bulwark tab keeps
 * every tab signed in; a warning counts down first; at zero the open and
 * minimised composers save their drafts and every account signs out, with
 * the reason on the login page.
 */
export function SessionTimeoutGuard() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const client = useAuthStore((s) => s.client);
  const revision = useAuthStore((s) => s.connectedAccountsRevision);
  const rawPolicy = usePolicyStore((s) => s.rawPolicy);
  const accountsKey = useAccountStore((s) => s.accounts.map((a) => `${a.id}|${a.signedInAt ?? ""}|${a.isConnected}`).join(","));

  const [limits, setLimits] = useState<SessionLimits>(NO_SESSION_LIMITS);
  const [state, setState] = useState<SessionTimerState>(IDLE_STATE);
  const [ending, setEnding] = useState(false);
  const [dismissedMax, setDismissedMax] = useState<number | null>(null);
  const timerRef = useRef<SessionTimer | null>(null);
  const channelRef = useRef<ActivityChannel | null>(null);
  const limitsRef = useRef(limits);
  limitsRef.current = limits;
  const endingRef = useRef(false);
  const active = isAuthenticated && !isDemoMode;

  useEffect(() => {
    if (!active) {
      setLimits(NO_SESSION_LIMITS);
      return;
    }
    let cancelled = false;
    void collectLimits().then((next) => {
      if (!cancelled) setLimits((prev) => (sameLimits(prev, next) ? prev : next));
    });
    return () => { cancelled = true; };
  }, [active, client, revision, rawPolicy, accountsKey]);

  useEffect(() => {
    setCurrentSessionLimits(active ? limits : null);
  }, [active, limits]);

  const endSession = useCallback(async (kind: SessionEndKind) => {
    if (endingRef.current) return;
    endingRef.current = true;
    setEnding(true);
    const current = limitsRef.current;
    rememberSessionEnd(kind === "max"
      ? { kind: "max", hours: current.max?.hours ?? 0 }
      : { kind: "idle", minutes: current.idle?.minutes ?? 0 });
    await flushComposers(DRAFT_FLUSH_TIMEOUT_MS);
    await useAuthStore.getState().logoutAll({ endProviderSession: false });
  }, []);

  // The clock, while there is a limit to count.
  const hasLimits = active && (!!limits.idle || !!limits.max);
  useEffect(() => {
    if (!hasLimits) {
      timerRef.current?.dispose();
      timerRef.current = null;
      setState(IDLE_STATE);
      return;
    }
    if (timerRef.current) {
      timerRef.current.setLimits(limits);
      return;
    }
    // A tab opened or reloaded after a long pause starts from the pause, a
    // fresh sign-in from the sign-in.
    const newestSignIn = Math.max(0, ...useAccountStore.getState().accounts.map((a) => a.signedInAt ?? 0));
    const lastActivity = Math.max(readLastActivity() ?? Date.now(), newestSignIn);
    timerRef.current = createSessionTimer({
      limits,
      lastActivity,
      onChange: setState,
      onExpire: (kind) => { void endSession(kind); },
    });
    setState(timerRef.current.state());
  }, [hasLimits, limits, endSession]);

  useEffect(() => () => {
    timerRef.current?.dispose();
    timerRef.current = null;
  }, []);

  useEffect(() => {
    if (!active) {
      endingRef.current = false;
      setEnding(false);
    }
  }, [active]);

  // Activity in this tab and the others.
  useEffect(() => {
    const channel = openActivityChannel((at) => timerRef.current?.remoteActivity(at));
    channelRef.current = channel;
    let lastSeen = 0;
    const onActivity = () => {
      if (endingRef.current) return;
      const at = Date.now();
      if (at - lastSeen < ACTIVITY_THROTTLE_MS) return;
      const timer = timerRef.current;
      if (timer) {
        timer.activity(at);
        // During the idle warning only "Stay signed in" counts.
        const s = timer.state();
        if (s.phase === "expired" || (s.phase === "warning" && s.kind === "idle")) return;
      }
      lastSeen = at;
      channel.post(at);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") timerRef.current?.check();
    };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const stay = useCallback(() => {
    const timer = timerRef.current;
    if (!timer) return;
    timer.stay();
    channelRef.current?.post(timer.lastActivity());
  }, []);

  const signOutNow = useCallback(() => {
    const kind = timerRef.current?.state().kind ?? "idle";
    void endSession(kind);
  }, [endSession]);

  if (!active) return null;
  if (ending) {
    return <SessionTimeoutDialog mode="ending" deadline={null} onStay={stay} onDismiss={stay} onSignOut={signOutNow} />;
  }
  if (state.phase !== "warning" || !state.kind) return null;
  if (state.kind === "max" && dismissedMax === state.deadline) return null;
  return (
    <SessionTimeoutDialog
      mode={state.kind}
      deadline={state.deadline}
      maxHours={limits.max?.hours}
      onStay={stay}
      onDismiss={() => setDismissedMax(state.deadline)}
      onSignOut={signOutNow}
    />
  );
}
