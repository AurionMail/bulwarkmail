"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { X, Loader2, UserPlus, Trash2, Users, ChevronDown } from "@/components/icons";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import type { Principal, PrincipalDirectoryStatus } from "@/lib/jmap/types";
import { detectPreset, presetRights, type AnyRights, type RolePreset, type ShareKind } from "@/lib/jmap/share-rights";
import { loadPrincipalDirectory } from "@/lib/jmap/principal-directory";
import { toast } from "@/stores/toast-store";

interface ShareCollectionDialogProps {
  client: IJMAPClient;
  kind: ShareKind;
  collectionName: string;
  shareWith: Record<string, AnyRights> | null | undefined;
  ownAccountId: string;
  onShare: (principalId: string, rights: AnyRights | null) => Promise<void>;
  onClose: () => void;
}

export function ShareCollectionDialog({
  client,
  kind,
  collectionName,
  shareWith,
  ownAccountId,
  onShare,
  onClose,
}: ShareCollectionDialogProps) {
  const t = useTranslations("sharing");
  const tCommon = useTranslations("common");
  const modalRef = useRef<HTMLDivElement>(null);
  const [allPrincipals, setAllPrincipals] = useState<Principal[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState<PrincipalDirectoryStatus>("ok");
  const [directoryQueriesOff, setDirectoryQueriesOff] = useState(false);
  const [loadingPrincipals, setLoadingPrincipals] = useState(true);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Load principals on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingPrincipals(true);
    void loadPrincipalDirectory(client).then(({ principals, status, directoryQueriesOff }) => {
      if (cancelled) return;
      setAllPrincipals(principals);
      setDirectoryStatus(status);
      setDirectoryQueriesOff(!!directoryQueriesOff);
      setLoadingPrincipals(false);
    });
    return () => { cancelled = true; };
  }, [client]);

  // Map of every fetched principal by id, used for name/description lookups in
  // the shared list. Must include principals that already have a share so the
  // list shows their name rather than the raw id.
  const allPrincipalsById = useMemo(() => {
    const map = new Map<string, Principal>();
    for (const p of allPrincipals) map.set(p.id, p);
    return map;
  }, [allPrincipals]);

  // Principals available to add: exclude self and anyone already shared with.
  const principals = useMemo(() => {
    const existing = new Set(Object.keys(shareWith || {}));
    return allPrincipals.filter((p) => p.id !== ownAccountId && !existing.has(p.id));
  }, [allPrincipals, ownAccountId, shareWith]);

  // Close on Escape, focus trap, click outside
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSetRights = async (principalId: string, preset: RolePreset) => {
    if (preset === "custom") return; // custom is read-only here
    const rights = presetRights(kind, preset);
    if (!rights) return;
    setSavingId(principalId);
    try {
      await onShare(principalId, rights);
      toast.success(t("share_updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("share_failed"));
    } finally {
      setSavingId(null);
    }
  };

  const handleRemove = async (principalId: string) => {
    setSavingId(principalId);
    try {
      await onShare(principalId, null);
      toast.success(t("share_removed"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("share_failed"));
    } finally {
      setSavingId(null);
    }
  };

  const handleAdd = async (principal: Principal) => {
    const rights = presetRights(kind, "read");
    if (!rights) return;
    setSavingId(principal.id);
    try {
      await onShare(principal.id, rights);
      setShowAdd(false);
      setSearch("");
      toast.success(t("share_added"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("share_failed"));
    } finally {
      setSavingId(null);
    }
  };

  const filteredPrincipals = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return principals;
    return principals.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.email?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q)
    );
  }, [principals, search]);

  const sharedEntries = useMemo(() => {
    return Object.entries(shareWith || {}) as [string, AnyRights][];
  }, [shareWith]);

  const presetOptions = kind === "calendar"
    ? ["freeBusy", "read", "readWrite", "manager"] as const
    : ["read", "readWrite", "manager"] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("title", { name: collectionName })}
        className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 animate-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">{t("title", { name: collectionName })}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted transition-colors duration-150 text-muted-foreground hover:text-foreground"
            aria-label={tCommon("close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          <p className="text-sm text-muted-foreground">{t("description")}</p>

          {sharedEntries.length === 0 && !showAdd && (
            <div className="text-sm text-muted-foreground italic py-4 text-center">
              {t("no_shares")}
            </div>
          )}

          {sharedEntries.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
              {sharedEntries.map(([principalId, rights]) => {
                const principal = allPrincipalsById.get(principalId);
                // Stalwart 1.0 with directory queries off hides every principal
                // the user has no relationship with, so a sharee may have no name.
                const unresolved = !principal && !loadingPrincipals;
                const preset = detectPreset(kind, rights);
                return (
                  <li key={principalId} className="flex items-center gap-3 px-3 py-2.5">
                    <Avatar
                      name={principal?.name}
                      email={principal?.email ?? undefined}
                      size="sm"
                      className="shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {principal?.name || principal?.email || (unresolved ? t("unknown_user") : principalId)}
                      </div>
                      {unresolved && (
                        <div className="text-xs text-muted-foreground truncate">{principalId}</div>
                      )}
                      {principal?.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {principal.description}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <select
                        value={preset}
                        onChange={(e) => handleSetRights(principalId, e.target.value as RolePreset)}
                        disabled={savingId === principalId}
                        className="appearance-none rounded-md border border-input bg-background ps-3 pe-8 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      >
                        {presetOptions.map((p) => (
                          <option key={p} value={p}>{t(`preset.${p}`)}</option>
                        ))}
                        {preset === "custom" && (
                          <option value="custom">{t("preset.custom")}</option>
                        )}
                      </select>
                      <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                    </div>
                    <button
                      onClick={() => handleRemove(principalId)}
                      disabled={savingId === principalId}
                      className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      aria-label={t("remove")}
                      title={t("remove")}
                    >
                      {savingId === principalId
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!showAdd && (
            <Button
              variant="outline"
              onClick={() => setShowAdd(true)}
              className="w-full"
            >
              <UserPlus className="w-4 h-4 me-2" />
              {t("add_person")}
            </Button>
          )}

          {showAdd && (
            <div className="space-y-2 border border-border rounded-md p-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search_placeholder")}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
              {/* The list below is partial or empty for a reason the user
                  can't see otherwise; say so instead of "no users found". Only
                  Stalwart 1.0's own refusal says who is still listed and what
                  an administrator can do: a 0.16 role without the permission
                  gets another refusal, and a list of everyone after it. */}
              {!loadingPrincipals && directoryStatus !== "ok" && (
                <p className="text-xs text-muted-foreground" role="status">
                  {directoryStatus === "error"
                    ? t("directory_failed")
                    : directoryQueriesOff ? t("directory_restricted") : t("directory_not_browsable")}
                </p>
              )}
              <div className="max-h-48 overflow-y-auto -mx-1">
                {loadingPrincipals && (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin me-2" />
                    {t("loading_principals")}
                  </div>
                )}
                {!loadingPrincipals && filteredPrincipals.length === 0 && (search.trim() || directoryStatus === "ok") && (
                  <div className="text-xs text-muted-foreground text-center py-3">
                    {search.trim() ? t("no_match") : t("no_principals")}
                  </div>
                )}
                {!loadingPrincipals && filteredPrincipals.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleAdd(p)}
                    disabled={savingId === p.id}
                    className="w-full text-start px-3 py-2 rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Avatar
                        name={p.name}
                        email={p.email ?? undefined}
                        size="sm"
                        className="shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate flex items-center gap-2">
                          {p.name}
                          {p.type === "group" && (
                            <span className="text-[10px] uppercase font-normal text-muted-foreground bg-muted rounded px-1 py-0.5">
                              {t("group")}
                            </span>
                          )}
                        </div>
                        {p.email && p.email !== p.name && (
                          <div className="text-xs text-muted-foreground truncate">{p.email}</div>
                        )}
                      </div>
                      {savingId === p.id && <Loader2 className="w-4 h-4 animate-spin" />}
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setSearch(""); }}>
                  {tCommon("cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <Button onClick={onClose}>{tCommon("close")}</Button>
        </div>
      </div>
    </div>
  );
}
