import type { IJMAPClient } from "@/lib/jmap/client-interface";
import type { Email } from "@/lib/jmap/types";

/**
 * Message bodies requested ahead of the click that opens them.
 *
 * A mouse press on a row comes roughly a tenth of a second before the click
 * that follows it, and Chromium sends a fetch() only once the task that made
 * it has ended: the click's task ends after its whole render pass, the
 * press's task at once. So the body is requested on the press and the open
 * takes over the request already on its way. A request nobody claims within
 * PREFETCH_TTL_MS is dropped (the press may have started a drag or a
 * selection instead).
 */
const PREFETCH_TTL_MS = 5_000;
const pending = new Map<string, { at: number; email: Promise<Email | null> }>();

const keyFor = (client: IJMAPClient, emailId: string, accountId: string | undefined) =>
  `${client.getAccountId()}|${accountId ?? ""}|${emailId}`;

function dropStale(now: number): void {
  for (const [key, entry] of pending) if (now - entry.at > PREFETCH_TTL_MS) pending.delete(key);
}

/** Starts fetching a message's content, unless that request is already on its way. */
export function prefetchEmailContent(client: IJMAPClient, emailId: string, accountId?: string): void {
  const now = Date.now();
  dropStale(now);
  const key = keyFor(client, emailId, accountId);
  if (pending.has(key)) return;
  const email = client.getEmail(emailId, accountId);
  // A prefetch nobody claims must not surface as an unhandled rejection; the
  // open that claims it still sees the failure.
  email.catch(() => {});
  pending.set(key, { at: now, email });
}

/** The message's content: the request a press already started, else a new one. */
export function requestEmailContent(client: IJMAPClient, emailId: string, accountId?: string): Promise<Email | null> {
  const key = keyFor(client, emailId, accountId);
  const entry = pending.get(key);
  pending.delete(key);
  if (entry && Date.now() - entry.at <= PREFETCH_TTL_MS) return entry.email;
  return client.getEmail(emailId, accountId);
}

/** For tests. */
export function forgetEmailPrefetches(): void {
  pending.clear();
}
