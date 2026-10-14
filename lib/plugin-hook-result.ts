// "Before" hooks whose handlers may either stop an action (return false) or
// change what it does (return a value), such as onBeforeExternalLink
// (`{ href }`) and onBeforeCompose (a ComposeOptions to prefill).
//
// HookBus.intercept() only reports whether the action may go ahead and drops
// every other return value; HookBus.transform() keeps return values but
// ignores `false`. Running both would call every plugin twice (and show any
// confirmation dialog twice), so this walks the handlers once and honours
// both answers. A payload changed in place has no effect: plugin handlers run
// in a sandboxed iframe and receive a copy.

import { pluginErrorTracker, uiHooks, type HookBus } from './plugin-hooks';
import type { ExternalLinkContext } from './plugin-types';
import { isOpenableLinkHref } from './email-sanitization';

// Same budget as HookBus.intercept: these hooks may wait on a dialog.
const INTERCEPT_TIMEOUT_MS = 60_000;

interface Entry {
  pluginId: string;
  handler: (...args: unknown[]) => unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handlersOf(bus: HookBus<any>): Entry[] | null {
  const handlers = (bus as unknown as { handlers?: unknown }).handlers;
  return Array.isArray(handlers) ? [...(handlers as Entry[])] : null;
}

function withTimeout<T>(value: T | Promise<T>, ms: number): Promise<T> {
  if (!(value instanceof Promise)) return Promise.resolve(value);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Hook timed out after ${ms}ms`)), ms);
    value.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export type InterceptResult<V> = { allowed: false } | { allowed: true; value: V };

/**
 * Ask every handler of an intercept bus, in order. `false` stops the action;
 * any other return value goes through `accept`, which turns it into the next
 * value or returns undefined to ignore it. Like `intercept`, a handler that
 * throws or times out is skipped (fail open).
 *
 * `plainIntercept` is the bus's own `intercept`, used when its handlers can't
 * be walked (a test double): the veto still works, return values are lost.
 */
export async function interceptWithResult<V>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bus: HookBus<any>,
  value: V,
  accept: (result: unknown, current: V) => V | undefined,
  plainIntercept: (value: V) => Promise<boolean>,
): Promise<InterceptResult<V>> {
  // No listeners (or a test double without a size): nothing to ask.
  if (!(bus && bus.size > 0)) return { allowed: true, value };
  const handlers = handlersOf(bus);
  if (!handlers) {
    return (await plainIntercept(value)) ? { allowed: true, value } : { allowed: false };
  }
  let current = value;
  for (const { pluginId, handler } of handlers) {
    if (pluginErrorTracker.isDisabled(pluginId)) continue;
    let result: unknown;
    try {
      result = await withTimeout(handler(current), INTERCEPT_TIMEOUT_MS);
    } catch (err) {
      pluginErrorTracker.record(pluginId, err);
      continue;
    }
    if (result === false) return { allowed: false };
    if (result === undefined || result === null || result === true) continue;
    const next = accept(result, current);
    if (next !== undefined) current = next;
  }
  return { allowed: true, value: current };
}

/**
 * `accept` for onBeforeExternalLink: a handler may return `{ href }` to send
 * the click elsewhere. Only a web address is taken, so a plugin can't turn a
 * link into javascript:, data: or a path inside the app.
 */
export function acceptLinkRewrite<T extends { href: string }>(result: unknown, current: T): T | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const href = (result as { href?: unknown }).href;
  if (typeof href !== 'string') return undefined;
  const trimmed = href.trim();
  if (!/^https?:/i.test(trimmed)) return undefined;
  try {
    new URL(trimmed);
  } catch {
    return undefined;
  }
  return { ...current, href: trimmed };
}

/**
 * Ask onBeforeExternalLink about a click on a link in a message. Resolves to
 * the address to open: the original, the one a plugin rewrote it to, or null
 * when a plugin stopped it.
 */
export async function resolveExternalLink(ctx: ExternalLinkContext): Promise<string | null> {
  const outcome = await interceptWithResult(uiHooks.onBeforeExternalLink, ctx, acceptLinkRewrite, (c) => uiHooks.onBeforeExternalLink.intercept(c));
  if (!outcome.allowed || !isOpenableLinkHref(outcome.value.href)) return null;
  return outcome.value.href;
}
