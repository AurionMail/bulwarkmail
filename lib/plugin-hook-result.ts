// "Before" hooks whose handlers may either stop an action (return false) or
// change what it does (return a value), such as onBeforeExternalLink
// (`{ href }`) and onBeforeCompose (a ComposeOptions to prefill). A payload
// changed in place has no effect: plugin handlers run in a sandboxed iframe
// and receive a copy.

import { uiHooks, type HookBus } from './plugin-hooks';
import type { ExternalLinkContext } from './plugin-types';
import { isOpenableLinkHref } from './email-sanitization';

export type InterceptResult<V> = { allowed: false } | { allowed: true; value: V };

/**
 * Ask every handler of an intercept bus once, in order. `false` stops the
 * action; any other return value goes through `accept`. See
 * HookBus.interceptWithValue.
 */
export async function interceptWithResult<V>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bus: HookBus<any>,
  value: V,
  accept: (result: unknown, current: V) => V | undefined,
): Promise<InterceptResult<V>> {
  if (!(bus && bus.size > 0)) return { allowed: true, value };
  return bus.interceptWithValue(value, accept);
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
  const outcome = uiHooks.onBeforeExternalLink.size > 0
    ? await uiHooks.onBeforeExternalLink.interceptWithValue(ctx, acceptLinkRewrite)
    : { allowed: true as const, value: ctx };
  if (!outcome.allowed || !isOpenableLinkHref(outcome.value.href)) return null;
  return outcome.value.href;
}
