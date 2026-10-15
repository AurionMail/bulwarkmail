import { useLayoutEffect, useMemo, useRef } from "react";

type Handler = (...args: never[]) => unknown;
type Handlers = Record<string, Handler | undefined>;

/**
 * Identity-stable stand-ins for a set of event handlers.
 *
 * A list that hands each row inline closures gives every row new props on
 * every render, so memoising the rows achieves nothing. The handlers returned
 * here keep their identity for the life of the component and forward to
 * whatever was passed on the latest render, so a memoised row can be skipped
 * without ever calling a stale closure.
 *
 * Only for handlers invoked after render (clicks, drags, keyboard): the latest
 * set is published in a layout effect, so calling one during render would
 * still see the previous render's closure. A handler that is `undefined` stays
 * `undefined`, because rows use a handler's presence to decide what to show;
 * the returned object only changes identity when that presence changes.
 */
export function useStableHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });

  const present = Object.keys(handlers)
    .filter((key) => handlers[key] !== undefined)
    .sort()
    .join(",");

  return useMemo(() => {
    const stable: Handlers = {};
    for (const key of present ? present.split(",") : []) {
      stable[key] = ((...args: never[]) => latest.current[key]?.(...args)) as Handler;
    }
    return stable as T;
  }, [present]);
}
