"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Undo } from "@/components/icons";
import { SettingsSection } from "@/components/settings/settings-section";
import { usePolicyStore } from "@/stores/policy-store";
import { useRecoveryStore } from "@/stores/recovery-store";
import { toast } from "@/stores/toast-store";
import { useDeletedItemsRecovery } from "@/hooks/use-deleted-items-recovery";
import { classifyArchiveError, visibleArchivedItems, type ArchivedEmail } from "@/lib/recovery/archived-items";

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: ArchivedEmail[] };

/**
 * Settings > Recover deleted items: the messages the user deleted for good
 * that Stalwart still keeps (Enterprise, `archiveDeletedItemsFor`), newest
 * first, limited to the admin's `organisation.recovery.days`. Restoring asks
 * the server to put them back in the Inbox; it does that in the background.
 */
export function RecoverDeletedSettings() {
  const t = useTranslations("recover_deleted");
  const format = useFormatter();
  const { available, client, key } = useDeletedItemsRecovery();
  const days = usePolicyStore((s) => s.getOrganisation().recovery.days);
  const record = useRecoveryStore((s) => s.record);

  const [list, setList] = useState<ListState>({ status: "loading" });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [restoring, setRestoring] = useState(false);
  const [failedCount, setFailedCount] = useState(0);

  // An answer that arrives after a newer read started (another account) is dropped.
  const readSeq = useRef(0);
  const load = useCallback(async () => {
    if (!client?.listArchivedEmails || !key) return;
    const seq = ++readSeq.current;
    setList({ status: "loading" });
    try {
      const items = await client.listArchivedEmails();
      if (seq !== readSeq.current) return;
      setList({ status: "ready", items });
    } catch (error) {
      if (seq !== readSeq.current) return;
      // A refusal now (the license ran out) hides the page like detection
      // would; anything else shows the error with a retry.
      if (classifyArchiveError(error) === "unsupported") record(key, "unsupported");
      setList({ status: "error" });
    }
  }, [client, key, record]);

  useEffect(() => {
    if (!available) return;
    setSelected(new Set());
    setFailedCount(0);
    void load();
    const reads = readSeq;
    return () => {
      reads.current++;
    };
  }, [available, load]);

  const items = useMemo(() => (list.status === "ready" ? visibleArchivedItems(list.items, days) : []), [list, days]);

  if (!available || !client) return null;

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));

  const restore = async () => {
    const ids = items.filter((item) => selected.has(item.id)).map((item) => item.id);
    if (ids.length === 0 || !client.restoreArchivedItems) return;
    setRestoring(true);
    try {
      const results = await client.restoreArchivedItems(ids);
      const done = new Set(results.filter((r) => r.ok).map((r) => r.id));
      const failed = ids.filter((id) => !done.has(id));
      setFailedCount(failed.length);
      // Restored items leave the archive; the ones that failed stay selected to try again.
      setList((prev) => (prev.status === "ready" ? { status: "ready", items: prev.items.filter((item) => !done.has(item.id)) } : prev));
      setSelected(new Set(failed));
      if (done.size > 0) toast.success(t("restored", { count: done.size }));
      if (failed.length > 0) toast.error(t("restore_partial", { count: failed.length }));
    } finally {
      setRestoring(false);
    }
  };

  const dateOf = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }) : "");

  return (
    <SettingsSection id="recover-deleted" title={t("title")} description={t("description")}>
      <p className="text-sm text-muted-foreground" data-testid="recover-deleted-range">
        {days > 0 ? t("range_days", { days }) : t("range_all")}
      </p>

      {list.status === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" data-testid="recover-deleted-loading">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </p>
      )}

      {list.status === "error" && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert" data-testid="recover-deleted-error">
          <span>{t("load_failed")}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>{t("retry")}</Button>
        </div>
      )}

      {list.status === "ready" && items.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="recover-deleted-empty">{t("empty")}</p>
      )}

      {list.status === "ready" && items.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-11 items-center gap-2 pe-2 text-sm sm:min-h-0">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t("select_all")} data-testid="recover-deleted-select-all" />
              <span>{selected.size > 0 ? t("selected", { count: selected.size }) : t("select_all")}</span>
            </label>
            <div className="ms-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={restoring} aria-label={t("refresh")}>
                <RefreshCw className="h-4 w-4 sm:me-2" />
                <span className="hidden sm:inline">{t("refresh")}</span>
              </Button>
              <Button size="sm" onClick={() => void restore()} disabled={restoring || selected.size === 0} data-testid="recover-deleted-restore">
                {restoring ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Undo className="me-2 h-4 w-4" />}
                {t("restore")}
              </Button>
            </div>
          </div>

          {failedCount > 0 && (
            <p className="text-sm text-destructive" role="status" data-testid="recover-deleted-partial">
              {t("restore_partial", { count: failedCount })}
            </p>
          )}

          <ul className="divide-y divide-border rounded-md border border-border" data-testid="recover-deleted-list">
            {items.map((item) => {
              const sender = item.fromName || item.fromEmail || t("unknown_sender");
              const checkboxId = `recover-${item.id}`;
              return (
                <li key={item.id} className="flex items-start gap-3 px-3 py-3" data-testid="recover-deleted-row">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    disabled={restoring}
                  />
                  <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                      <span className="truncate text-sm font-medium" title={item.fromEmail || undefined}>{sender}</span>
                      {item.receivedAt && <span className="shrink-0 text-xs text-muted-foreground sm:ms-auto">{dateOf(item.receivedAt)}</span>}
                    </div>
                    <div className="truncate text-sm">{item.subject || t("no_subject")}</div>
                    <div className="text-xs text-muted-foreground">{t("deleted_on", { date: dateOf(item.archivedAt) })}</div>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">{t("restore_hint")}</p>
        </div>
      )}
    </SettingsSection>
  );
}
