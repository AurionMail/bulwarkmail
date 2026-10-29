"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Loader2 } from "@/components/icons";
import { cn } from "@/lib/utils";
import { isFilterEmpty } from "@/lib/jmap/search-utils";
import { runPluginAction } from "@/lib/plugin-sandbox/actions";
import type { ProvidedSearchResult } from "@/lib/plugin-search-results";
import type { SearchResultEmail } from "@/lib/plugin-types";
import type { Email } from "@/lib/jmap/types";
import { useAuthStore } from "@/stores/auth-store";
import { useEmailStore } from "@/stores/email-store";
import { usePluginStore } from "@/stores/plugin-store";

interface Group {
  id: string;
  heading: string;
  results: ProvidedSearchResult[];
}

/** One group per plugin and source, in the order the entries came. */
function groupResults(results: ProvidedSearchResult[], pluginName: (id: string) => string): Group[] {
  const groups = new Map<string, Group>();
  for (const r of results) {
    const id = `${r.pluginId}\u0000${r.source ?? ""}`;
    let group = groups.get(id);
    if (!group) {
      group = { id, heading: r.source ?? pluginName(r.pluginId), results: [] };
      groups.set(id, group);
    }
    group.results.push(r);
  }
  return [...groups.values()];
}

/** A message as the reader opens one that is not a row of the list: the login reaching it and its account. */
export type OpenableEmail = Required<Pick<Email, "id" | "sourceClientAccountId" | "sourceAccountId">>;

/**
 * The login through which the user reaches a message an entry names, the
 * active one first; null when none does (an account the user cannot read).
 * Without an account the message is the active login's own.
 */
export function reachableEmail(email: SearchResultEmail): OpenableEmail | null {
  const auth = useAuthStore.getState();
  const clients = [...auth.getAllConnectedClients()]
    .sort(([a], [b]) => Number(b === auth.activeAccountId) - Number(a === auth.activeAccountId));
  for (const [login, client] of clients) {
    if (!email.accountId) {
      return login === auth.activeAccountId
        ? { id: email.id, sourceClientAccountId: login, sourceAccountId: client.getAccountId() }
        : null;
    }
    const reaches = client.getAccountId() === email.accountId
      || client.getSharedAccounts().some((a) => a.id === email.accountId && a.capabilities.mail);
    if (reaches) return { id: email.id, sourceClientAccountId: login, sourceAccountId: email.accountId };
  }
  return null;
}

/** The active login's own account. */
function ownAccountId(): string | undefined {
  const auth = useAuthStore.getState();
  return auth.activeAccountId ? auth.getAllConnectedClients().get(auth.activeAccountId)?.getAccountId() : undefined;
}

/**
 * Whether the message open in the reader is the one an entry names. JMAP ids
 * are unique per account only, so the accounts are compared too, a missing
 * one being the active login's own.
 */
function isOpen(email: SearchResultEmail | undefined, open: Email | null): boolean {
  if (!email || !open || open.id !== email.id) return false;
  const own = ownAccountId();
  return (open.sourceAccountId ?? own) === (email.accountId ?? own);
}

/** ms a plugin may take before the block holds its place for the entries to come. */
export const PENDING_GRACE_MS = 300;

/**
 * Whether the block holds its place for this search: a plugin asked had not
 * answered after PENDING_GRACE_MS. Kept once the answers came, until the next
 * search asks again, so the block keeps its height and the list below does
 * not move a second time. A plugin that answers at once (one that does not
 * search for this query) shows nothing.
 */
function useHeldPlace(pending: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!pending) return;
    setHeld(false);
    const timer = setTimeout(() => setHeld(true), PENDING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [pending]);
  return held;
}

interface PluginSearchResultsProps {
  /** Entries plugins return from onProvideSearchResults; a click is the plugin's onAction. */
  surface: "search-results";
  /** Opens a message in the reader, as a click on a list row does; without it every click is onAction. */
  onOpenEmail?: (email: OpenableEmail) => void;
}

/**
 * Results from elsewhere for the search that is running (CRM hits, chat
 * messages, ...), above its message list. Renders nothing outside a search or
 * without entries. While a plugin takes longer than PENDING_GRACE_MS the block
 * shows at a fixed height with placeholder rows, which its entries then fill,
 * so the list moves once, with its own results, not when a slow plugin
 * answers. A click on an entry naming a message the user reaches opens it; any
 * other goes back to the plugin that gave the entry.
 */
export function PluginSearchResults({ surface, onOpenEmail }: PluginSearchResultsProps) {
  const results = useEmailStore((s) => s.externalSearchResults);
  const openEmail = useEmailStore((s) => s.selectedEmail);
  const query = useEmailStore((s) => s.searchQuery);
  const searching = useEmailStore((s) => !!s.searchQuery.trim() || !isFilterEmpty(s.searchFilters));
  const pending = useEmailStore((s) => s.externalSearchPending.length > 0);
  const plugins = usePluginStore((s) => s.plugins);
  const held = useHeldPlace(pending);
  const t = useTranslations('email_list');
  const idPrefix = useId();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const groups = useMemo(
    () => groupResults(results, (id) => plugins.find((p) => p.id === id)?.name ?? id),
    [results, plugins],
  );

  const waiting = pending && held;
  if (!searching || (groups.length === 0 && !waiting)) return null;

  const click = (r: ProvidedSearchResult) => {
    const reachable = r.email && onOpenEmail ? reachableEmail(r.email) : null;
    if (reachable) onOpenEmail?.(reachable);
    else void runPluginAction(r.pluginId, surface, r.key, { query });
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      data-plugin-surface={surface}
      className={cn("max-h-[40%] flex-shrink-0 overflow-y-auto border-b border-border bg-muted/30", held && "h-48")}
    >
      {groups.map((group, index) => {
        const open = !collapsed.has(group.id);
        const listId = `${idPrefix}-${index}`;
        return (
          <section key={group.id} aria-label={group.heading}>
            <button
              type="button"
              onClick={() => toggle(group.id)}
              aria-expanded={open}
              aria-controls={listId}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="truncate">{group.heading}</span>
              <span className="font-normal">({group.results.length})</span>
            </button>
            {open && (
              <ul id={listId} className="pb-1">
                {group.results.map((r) => {
                  const current = isOpen(r.email, openEmail);
                  return (
                    <li key={r.key}>
                      <button
                        type="button"
                        onClick={() => click(r)}
                        aria-current={current ? "true" : undefined}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-start",
                          "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                          current && "bg-accent",
                        )}
                      >
                        <span className="w-full truncate text-sm font-medium text-foreground">{r.title}</span>
                        {r.snippet && <span className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      {waiting && (
        <section aria-label={t('more_results_searching')} aria-busy="true">
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="truncate">{t('more_results_searching')}</span>
          </div>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex flex-col gap-1.5 px-3 py-2" aria-hidden="true">
              <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-4/5 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
