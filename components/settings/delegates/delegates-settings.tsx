"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader2, UserPlus } from "@/components/icons";
import { SettingsSection } from "@/components/settings/settings-section";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/stores/toast-store";
import { useRestriction } from "@/hooks/use-restriction";
import { loadPrincipalDirectory } from "@/lib/jmap/principal-directory";
import type { Principal, PrincipalListing } from "@/lib/jmap/types";
import type { ShareChangeResult, ShareTarget } from "@/lib/jmap/share-batch";
import type { ShareKind } from "@/lib/jmap/share-rights";
import {
  allowedLevels,
  buildRevokeChanges,
  failedChanges,
  scopeOfSummary,
  summarizeDelegates,
  type DelegateSummary,
} from "@/lib/delegation/delegation";
import { rememberPrincipals, rememberedPrincipals } from "@/lib/delegation/known-principals";
import { DelegateDialog, type DelegateDialogProps } from "./delegate-dialog";
import { principalDisplay } from "./principal-display";

type DialogState = { mode: "add" } | { mode: "change"; summary: DelegateSummary } | null;

/**
 * Settings > Sharing > Delegates: give someone access to mail, calendars
 * and contacts in one step, and see and take back who has access to what.
 * Hidden when the admin hides `delegation`; `delegationRights` limits the
 * rights offered.
 */
export function DelegatesSettings() {
  const t = useTranslations("delegates");
  const client = useAuthStore((s) => s.client);
  const accountKey = useAuthStore((s) => s.activeAccountId) ?? "";
  const delegation = useRestriction("delegation");
  const rights = useRestriction("delegationRights");
  const levels = useMemo(() => allowedLevels(rights.allowedValues), [rights.allowedValues]);

  const [targets, setTargets] = useState<ShareTarget[] | null>(null);
  const [failedKinds, setFailedKinds] = useState<ShareKind[]>([]);
  const [directory, setDirectory] = useState<PrincipalListing | null>(null);
  const [remembered, setRemembered] = useState<Map<string, Principal>>(() => new Map());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirmRemove, setConfirmRemove] = useState<DelegateSummary | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!client?.getShareTargets) return;
    const result = await client.getShareTargets();
    setTargets(result.targets);
    setFailedKinds(result.failed);
  }, [client]);

  useEffect(() => {
    if (!client || delegation.hidden) return;
    let cancelled = false;
    setTargets(null);
    setDirectory(null);
    setRemembered(rememberedPrincipals(accountKey));
    void reload();
    void loadPrincipalDirectory(client).then((listing) => {
      if (cancelled) return;
      setDirectory(listing);
      rememberPrincipals(accountKey, listing.principals);
    });
    return () => { cancelled = true; };
  }, [client, accountKey, delegation.hidden, reload]);

  const ownIds = useMemo(() => (client ? [client.getAccountId()] : []), [client]);
  const summaries = useMemo(() => (targets ? summarizeDelegates(targets, ownIds) : []), [targets, ownIds]);

  // Stalwart names a principal by its account id, and an account shared with
  // the user is in the session under the owner's address: a last way to name
  // someone the directory won't (Stalwart 1.0 with directory queries off).
  const sessionAccounts = useMemo(() => new Map((client?.getSharedAccounts() ?? []).map((a) => [a.id, a.name])), [client]);
  const principalFor = useCallback((id: string): Principal | null => {
    const known = directory?.principals.find((p) => p.id === id) ?? remembered.get(id);
    if (known) return known;
    const accountName = sessionAccounts.get(id);
    return accountName ? { id, name: accountName, email: accountName.includes('@') ? accountName : null, type: 'individual' } : null;
  }, [directory, remembered, sessionAccounts]);

  if (delegation.hidden || !client) return null;

  const onApplied: DelegateDialogProps["onApplied"] = (principal, results) => {
    rememberPrincipals(accountKey, [principal]);
    setRemembered(rememberedPrincipals(accountKey));
    const failed = failedChanges(results);
    if (failed.length === 0) {
      toast.success(dialog?.mode === "change" ? t("updated") : t("applied", { name: principalDisplay(principal).name }));
    }
    void reload();
  };

  const remove = async (summary: DelegateSummary) => {
    if (!targets || !client.applyShareChanges) return;
    setRemovingId(summary.principalId);
    try {
      const results: ShareChangeResult[] = await client.applyShareChanges(buildRevokeChanges(targets, summary.principalId));
      const failed = failedChanges(results);
      if (failed.length === 0) toast.success(t("removed"));
      else toast.error(t("remove_partial", { items: failed.map((f) => f.change.name).join(", ") }));
      await reload();
    } finally {
      setRemovingId(null);
    }
  };

  const nameOf = (id: string) => {
    const principal = principalFor(id);
    return principal ? principalDisplay(principal).name : t("unknown_person");
  };

  return (
    <SettingsSection id="delegates" title={t("title")} description={t("description")}>
      <div>
        <Button onClick={() => setDialog({ mode: "add" })} disabled={!targets} data-testid="delegates-give-access">
          <UserPlus className="me-2 h-4 w-4" />
          {t("give_access")}
        </Button>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t("who_has_access")}</h4>
        {failedKinds.length > 0 && <p className="text-xs text-destructive" role="status">{t("read_failed")}</p>}
        {targets === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>
        ) : summaries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("nobody")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border" data-testid="delegates-list">
            {summaries.map((summary) => {
              const principal = principalFor(summary.principalId);
              const display = principal ? principalDisplay(principal) : { name: t("unknown_person"), detail: summary.principalId };
              return (
                <li key={summary.principalId} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center" data-testid="delegate-row">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={principal?.name} email={principal?.email ?? undefined} size="sm" className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{display.name}</div>
                      {display.detail && <div className="truncate text-xs text-muted-foreground">{display.detail}</div>}
                      <div className="text-xs text-muted-foreground">{describeSummary(summary, t)}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2 ps-11 sm:ps-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialog({ mode: "change", summary })}
                      disabled={removingId === summary.principalId}
                    >
                      {t("change")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmRemove(summary)}
                      disabled={removingId === summary.principalId}
                    >
                      {removingId === summary.principalId && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                      {t("remove")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {dialog && targets && (
        <DelegateDialog
          client={client}
          targets={targets}
          directory={directory}
          ownIds={ownIds}
          existingIds={new Set(summaries.map((s) => s.principalId))}
          initial={dialog.mode === "change"
            ? {
                principal: principalFor(dialog.summary.principalId)
                  ?? { id: dialog.summary.principalId, name: t("unknown_person"), type: "individual" },
                ...scopeOfSummary(dialog.summary, targets),
              }
            : undefined}
          levels={levels}
          levelsRestricted={rights.allowedValues !== null && levels.length < 2}
          onApplied={onApplied}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDialog
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => { if (confirmRemove) void remove(confirmRemove); }}
        title={confirmRemove ? t("remove_title", { name: nameOf(confirmRemove.principalId) }) : ""}
        message={confirmRemove ? t("remove_message", { name: nameOf(confirmRemove.principalId) }) : ""}
        confirmText={t("remove")}
        variant="destructive"
      />
    </SettingsSection>
  );
}

type Translate = ReturnType<typeof useTranslations<"delegates">>;

/** "All mail folders · 1 calendar · Read", in the order of the dialog. */
export function describeSummary(summary: DelegateSummary, t: Translate): string {
  const parts: string[] = [];
  const { mail, calendars, addressBooks, files } = summary;
  if (mail.shared > 0) {
    parts.push(mail.shared === mail.total
      ? t("summary.mail_all")
      : mail.shared === 1 && mail.inbox ? t("summary.mail_inbox") : t("summary.mail_some", { count: mail.shared }));
  }
  if (calendars.shared > 0) parts.push(t("summary.calendars", { count: calendars.shared }));
  if (addressBooks.shared > 0) parts.push(t("summary.address_books", { count: addressBooks.shared }));
  if (files > 0) parts.push(t("summary.files", { count: files }));
  parts.push(t(`level.${summary.level ?? "none"}`));
  return parts.join(" · ");
}
