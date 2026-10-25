"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import { isFilterEmpty } from "@/lib/jmap/search-utils";
import { runPluginAction } from "@/lib/plugin-sandbox/actions";
import type { ProvidedSearchResult } from "@/lib/plugin-search-results";
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

interface PluginSearchResultsProps {
  /** Entries plugins return from onProvideSearchResults; a click is the plugin's onAction. */
  surface: "search-results";
}

/**
 * Results from elsewhere for the search that is running (CRM hits, chat
 * messages, ...), above its message list. Renders nothing outside a search or
 * without entries. A click goes back to the plugin that gave the entry.
 */
export function PluginSearchResults({ surface }: PluginSearchResultsProps) {
  const results = useEmailStore((s) => s.externalSearchResults);
  const query = useEmailStore((s) => s.searchQuery);
  const searching = useEmailStore((s) => !!s.searchQuery.trim() || !isFilterEmpty(s.searchFilters));
  const plugins = usePluginStore((s) => s.plugins);
  const idPrefix = useId();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const groups = useMemo(
    () => groupResults(results, (id) => plugins.find((p) => p.id === id)?.name ?? id),
    [results, plugins],
  );

  if (!searching || groups.length === 0) return null;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div data-plugin-surface={surface} className="max-h-[40%] flex-shrink-0 overflow-y-auto border-b border-border bg-muted/30">
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
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" />}
              <span className="truncate">{group.heading}</span>
              <span className="font-normal">({group.results.length})</span>
            </button>
            {open && (
              <ul id={listId} className="pb-1">
                {group.results.map((r) => (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => { void runPluginAction(r.pluginId, surface, r.key, { query }); }}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-start",
                        "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                      )}
                    >
                      <span className="w-full truncate text-sm font-medium text-foreground">{r.title}</span>
                      {r.snippet && <span className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
