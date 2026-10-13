/**
 * Which shared (group/delegated) accounts get their mail folders listed in the
 * sidebar. Groups used only for shared calendars and contacts still come with
 * an empty mailbox the server will not delete, so users can hide them all or
 * one by one. Only the mail folders go; the account's calendars, contacts and
 * files are untouched. (#1228)
 */

/** JMAP accountIds hidden for this login. */
export function hiddenSharedMailIds(
  hidden: Record<string, string[]> | undefined,
  loginId: string | null | undefined,
): string[] {
  if (!loginId || !hidden) return [];
  const ids = hidden[loginId];
  return Array.isArray(ids) ? ids : [];
}

export function isSharedMailAccountVisible(
  accountId: string | undefined,
  showShared: boolean,
  hiddenIds: string[],
): boolean {
  if (!showShared) return false;
  return !accountId || !hiddenIds.includes(accountId);
}

/** The hidden map with one shared account hidden or shown again for a login. */
export function setSharedMailAccountHidden(
  hidden: Record<string, string[]>,
  loginId: string,
  accountId: string,
  hide: boolean,
): Record<string, string[]> {
  const current = hiddenSharedMailIds(hidden, loginId).filter((id) => id !== accountId);
  const next = hide ? [...current, accountId] : current;
  const result = { ...hidden };
  if (next.length > 0) result[loginId] = next;
  else delete result[loginId];
  return result;
}
