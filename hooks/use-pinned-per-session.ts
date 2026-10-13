import { useState } from "react";

/**
 * `value` as it was when `session` last changed. Later changes to `value`
 * are ignored until the next session starts.
 *
 * The composer uses it to remember the message a reply answers: Mountain
 * View keeps its compose window open while other mail is read (#1229), so the
 * open message is no longer the one being replied to.
 */
export function usePinnedPerSession<T>(session: number, value: T): T {
  const [pinned, setPinned] = useState<{ session: number; value: T }>({ session, value });
  if (pinned.session !== session) {
    setPinned({ session, value });
    return value;
  }
  return pinned.value;
}
