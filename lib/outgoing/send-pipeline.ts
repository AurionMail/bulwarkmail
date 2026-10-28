/**
 * One path for everything Bulwark does to a message on its way out, for
 * every surface that sends: the composer and quick reply. Features register
 * here instead of patching each send function:
 *
 * - pre-send checks run before anything is sent and may ask the user
 *   (the external-recipient confirm);
 * - finalisers change the bodies that go out (the organisation signature
 *   check, the legal disclaimer). They run on sends only, never on drafts,
 *   so a re-opened draft never carries what they add.
 *
 * With nothing registered both are no-ops.
 */

import { debug } from '@/lib/debug';

export type SendSurface = 'composer' | 'quick-reply';

export interface OutgoingContext {
  surface: SendSurface;
  /** Recipient addresses, without names. */
  to: string[];
  cc: string[];
  bcc: string[];
  /** The From address: the identity's, or one typed over it in the composer. */
  fromEmail?: string;
  identityId?: string;
  /** The chosen identity's own address (never a typed From override). */
  identityEmail?: string;
  /**
   * The signed-in account (AccountEntry id) the message goes out through,
   * when it isn't the active one: an identity of another account picked in
   * the composer. Checks use that account's policy and identities.
   */
  localAccountId?: string;
  /** compose, reply, replyAll or forward; quick reply is a reply. */
  mode: 'compose' | 'reply' | 'replyAll' | 'forward';
  /** Plain-text-only message (no HTML part). */
  plainText: boolean;
}

export interface OutgoingBodies {
  /** The HTML part; undefined for a plain-text-only message. */
  html?: string;
  text: string;
}

/** Changes the bodies; must return them unchanged when it has nothing to do. */
export type OutgoingFinalizer = (bodies: OutgoingBodies, context: OutgoingContext) => OutgoingBodies;

/** Resolves false to stop the send (after telling the user why, or asking them). */
export type PreSendCheck = (context: OutgoingContext) => boolean | Promise<boolean>;

interface Entry<T> {
  id: string;
  order: number;
  run: T;
}

const finalizers: Entry<OutgoingFinalizer>[] = [];
const checks: Entry<PreSendCheck>[] = [];

function register<T>(list: Entry<T>[], id: string, order: number, run: T): () => void {
  const existing = list.findIndex((entry) => entry.id === id);
  if (existing >= 0) list.splice(existing, 1);
  list.push({ id, order, run });
  list.sort((a, b) => a.order - b.order);
  return () => {
    const index = list.findIndex((entry) => entry.id === id && entry.run === run);
    if (index >= 0) list.splice(index, 1);
  };
}

/**
 * Adds a finaliser; lower `order` runs first. Registering the same id again
 * replaces it. Returns the unregister function.
 */
export function registerOutgoingFinalizer(id: string, order: number, run: OutgoingFinalizer): () => void {
  return register(finalizers, id, order, run);
}

/** Adds a pre-send check; lower `order` asks first. Returns the unregister function. */
export function registerPreSendCheck(id: string, order: number, run: PreSendCheck): () => void {
  return register(checks, id, order, run);
}

/** The bodies as they go out, after every finaliser. */
export function finalizeOutgoing(bodies: OutgoingBodies, context: OutgoingContext): OutgoingBodies {
  let current = bodies;
  for (const entry of finalizers) {
    try {
      current = entry.run(current, context);
    } catch (error) {
      // A broken finaliser must not stop the mail; it goes out without its change.
      debug.error(`Outgoing finaliser ${entry.id} failed:`, error);
    }
  }
  return current;
}

/**
 * Runs the checks in order and stops at the first that says no. A check
 * that throws is skipped: the checks warn, they don't guard, and a bug in
 * one must not make sending impossible.
 */
export async function runPreSendChecks(context: OutgoingContext): Promise<boolean> {
  for (const entry of [...checks]) {
    try {
      if (!(await entry.run(context))) {
        debug.log('email', `Send stopped by the pre-send check ${entry.id}`);
        return false;
      }
    } catch (error) {
      debug.error(`Pre-send check ${entry.id} failed:`, error);
    }
  }
  return true;
}

/** For tests: forget every registration. */
export function resetSendPipeline(): void {
  finalizers.length = 0;
  checks.length = 0;
}
