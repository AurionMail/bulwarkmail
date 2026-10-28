"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Pencil, Plus, Trash2, Users, X } from "@/components/icons";
import { TagBadge } from "@/components/email/tag-badge";
import { useAccountTags, TagScopeContext, clientForLogin, type TagScope } from "@/hooks/use-account-tags";
import { useRestriction } from "@/hooks/use-restriction";
import { MetadataTooLargeError } from "@/lib/jmap/bulwark-metadata";
import type { MailboxRights } from "@/lib/jmap/types";
import { composeKeywordId, MAX_KEYWORD_ID_LENGTH } from "@/lib/keyword-nesting";
import { MAX_SHARED_TAG_LABEL, groupAccountTags, removeSharedTag, upsertSharedTag } from "@/lib/shared-tags";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useEmailStore } from "@/stores/email-store";
import { useSettingsStore, type KeywordDefinition } from "@/stores/settings-store";
import { saveSharedTags, sharedTagsKey, useSharedTagsStore } from "@/stores/shared-tags-store";
import { toast } from "@/stores/toast-store";
import { toUnicodeEmail } from "@/lib/idn";
import { KeywordColorPicker } from "./keyword-settings";
import { OrgLockedNote } from "./org-locked-note";
import { SettingsSection } from "./settings-section";

/** Whether the rights on a group's Inbox let the user change its metadata. */
export function maySetSharedTags(rights: Partial<MailboxRights> | null | undefined): boolean {
  if (!rights) return false;
  // Stalwart 1.0 names the right; a server that doesn't counts renaming.
  return typeof rights.maySetMetadata === "boolean" ? rights.maySetMetadata : rights.mayRename === true;
}

/** The user's rights on the Inbox of a group account, from the folder list or asked once. */
function useInboxRights(scope: TagScope): Partial<MailboxRights> | null | undefined {
  const fromStore = useEmailStore((state) =>
    state.mailboxes.find((mailbox) => mailbox.accountId === scope.accountId && mailbox.role === "inbox")?.myRights);
  const [fetched, setFetched] = useState<Partial<MailboxRights> | null | undefined>(undefined);
  useEffect(() => {
    if (fromStore) return;
    let cancelled = false;
    const client = clientForLogin(scope.loginId) as unknown as { getMailboxes?: (accountId?: string) => Promise<Array<{ role?: string; myRights?: MailboxRights }>> } | null;
    if (!client?.getMailboxes) return;
    client.getMailboxes(scope.accountId)
      .then((mailboxes) => { if (!cancelled) setFetched(mailboxes.find((m) => m.role === "inbox")?.myRights ?? null); })
      .catch(() => { if (!cancelled) setFetched(null); });
    return () => { cancelled = true; };
  }, [fromStore, scope.loginId, scope.accountId]);
  return fromStore ?? fetched;
}

function SharedTagForm({
  initial,
  fixedId,
  takenIds,
  saving,
  onSave,
  onCancel,
}: {
  initial?: KeywordDefinition;
  /** The id stays: an existing tag or one found on messages. */
  fixedId?: string;
  takenIds: string[];
  saving: boolean;
  onSave: (tag: KeywordDefinition) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("shared_tags");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [color, setColor] = useState(initial?.color ?? "blue");
  const id = fixedId ?? composeKeywordId(null, label);
  const duplicate = !fixedId && id.length > 0 && takenIds.includes(id.toLowerCase());
  const tooLong = !fixedId && id.length > MAX_KEYWORD_ID_LENGTH;
  const valid = label.trim().length > 0 && id.length > 0 && !duplicate && !tooLong;
  const save = () => { if (valid && !saving) onSave({ id, label: label.trim(), color }); };

  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-accent/30 p-3" data-testid="shared-tag-form">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`shared-tag-label-${fixedId ?? "new"}`}>
          {t("name")}
        </label>
        <input
          id={`shared-tag-label-${fixedId ?? "new"}`}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={MAX_SHARED_TAG_LABEL}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
          }}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {duplicate && <p className="mt-1 text-xs text-destructive">{t("exists")}</p>}
        {tooLong && <p className="mt-1 text-xs text-destructive">{t("too_long")}</p>}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("colour")}</p>
        <KeywordColorPicker value={color} onChange={setColor} />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!valid || saving}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t("save")}
        </button>
      </div>
    </div>
  );
}

/**
 * The shared tags of one group account. Read-only with "Set by your
 * organisation" when the admin locked `sharedTags`, read-only with a note
 * when the user may not change the group's Inbox, and a one-line note
 * instead of the editor when the server keeps no metadata.
 */
function SharedAccountTagEditor({ scope, name }: { scope: TagScope; name: string }) {
  const t = useTranslations("shared_tags");
  const key = sharedTagsKey(scope.loginId, scope.accountId);
  const { status } = useAccountTags(scope);
  const entry = useSharedTagsStore((state) => state.entries[key]);
  const nested = useSettingsStore((state) => state.nestedTags);
  const { locked } = useRestriction("sharedTags");
  const rights = useInboxRights(scope);
  const canWrite = maySetSharedTags(rights);
  const editable = !locked && canWrite;
  const [editing, setEditing] = useState<{ id?: string; fixed?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const shared = useMemo(() => (status === "ready" ? entry?.tags ?? [] : []), [status, entry]);
  const discovered = useMemo(
    () => (status === "ready" && entry ? groupAccountTags(entry.tags, entry.discovered, nested).definitions.slice(entry.tags.length) : []),
    [status, entry, nested],
  );
  const takenIds = useMemo(() => [...shared, ...discovered].map((tag) => tag.id.toLowerCase()), [shared, discovered]);

  if (status === "personal") return null;

  const save = async (change: (list: KeywordDefinition[]) => KeywordDefinition[]) => {
    const client = clientForLogin(scope.loginId);
    if (!client) return false;
    setSaving(true);
    try {
      await saveSharedTags(key, scope.accountId, client, change);
      return true;
    } catch (error) {
      toast.error(error instanceof MetadataTooLargeError ? t("too_many") : t("save_failed"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const heading = (
    <div className="flex min-w-0 items-center gap-2">
      <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate text-sm font-medium text-foreground">{toUnicodeEmail(name)}</span>
    </div>
  );

  if (status === "loading") {
    return (
      <div className="space-y-2" data-testid="shared-tags-account" data-status="loading">
        {heading}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("loading")}
        </p>
      </div>
    );
  }

  if (status === "unsupported") {
    return (
      <div className="space-y-2" data-testid="shared-tags-account" data-status="unsupported">
        {heading}
        <p className="text-xs text-muted-foreground" data-testid="shared-tags-unsupported">{t("unsupported")}</p>
      </div>
    );
  }

  const row = (tag: KeywordDefinition, found: boolean) => {
    if (editing && editing.id === tag.id) {
      return (
        <SharedTagForm
          key={tag.id}
          initial={tag}
          fixedId={tag.id}
          takenIds={takenIds}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={async (next) => { if (await save((list) => upsertSharedTag(list, next))) setEditing(null); }}
        />
      );
    }
    return (
      <div
        key={tag.id}
        className="flex min-h-[44px] items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 sm:min-h-0"
        data-testid="shared-tag-row"
        data-tag-id={tag.id}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TagBadge tagId={tag.id} variant="badge" className="text-xs" />
          {found && <span className="truncate text-xs text-muted-foreground">{t("found_on_messages")}</span>}
        </div>
        {editable && confirmDelete === tag.id ? (
          <div className="flex shrink-0 items-center gap-1">
            <span className="hidden text-xs text-muted-foreground sm:inline">{t("delete_confirm")}</span>
            <button
              type="button"
              onClick={async () => { if (await save((list) => removeSharedTag(list, tag.id))) setConfirmDelete(null); }}
              className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
            >
              {t("delete")}
            </button>
            <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-md px-2 py-1 text-xs hover:bg-muted">
              {t("cancel")}
            </button>
          </div>
        ) : editable && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => { setEditing({ id: tag.id }); setConfirmDelete(null); }}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              title={found ? t("name_it") : t("edit")}
              aria-label={found ? t("name_it") : t("edit")}
            >
              {found ? <Plus className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            </button>
            {!found && (
              <button
                type="button"
                onClick={() => { setConfirmDelete(tag.id); setEditing(null); }}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                title={t("delete")}
                aria-label={t("delete")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <TagScopeContext.Provider value={scope}>
      <div className="space-y-2" data-testid="shared-tags-account" data-status="ready" data-editable={editable || undefined}>
        {heading}
        {shared.length === 0 && discovered.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("empty")}</p>
        )}
        {shared.map((tag) => row(tag, false))}
        {discovered.map((tag) => row(tag, true))}
        {locked ? (
          <OrgLockedNote />
        ) : !canWrite ? (
          <p className="text-xs text-muted-foreground" data-testid="shared-tags-no-rights">
            {rights === undefined ? t("loading") : t("no_rights")}
          </p>
        ) : editing && !editing.id ? (
          <SharedTagForm
            takenIds={takenIds}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={async (next) => { if (await save((list) => upsertSharedTag(list, next))) setEditing(null); }}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setEditing({}); setConfirmDelete(null); }}
            className={cn(
              "flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors",
              "hover:border-primary hover:bg-accent hover:text-foreground",
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("add")}
          </button>
        )}
      </div>
    </TagScopeContext.Provider>
  );
}

/**
 * Settings > Folders & tags > Shared tags: the tags of each group mailbox
 * the user is a member of. Hidden without group accounts.
 */
export function SharedTagSettings() {
  const t = useTranslations("shared_tags");
  const client = useAuthStore((state) => state.client);
  const loginId = useAuthStore((state) => state.activeAccountId);
  const accounts = useMemo(
    () => (client && typeof client.getSharedAccounts === "function"
      ? client.getSharedAccounts().filter((account) => !account.isPrimary && account.capabilities.mail && client.getAccountInfo?.(account.id)?.isPersonal === false)
      : []),
    [client],
  );
  const entries = useSharedTagsStore((state) => state.entries);
  if (!loginId || accounts.length === 0) return null;
  // Sharing by a person isn't a group: shown only once known not to be one.
  const groups = accounts.filter((account) => entries[sharedTagsKey(loginId, account.id)]?.status !== "personal");
  return (
    <div className={groups.length === 0 ? "hidden" : undefined}>
      <SettingsSection id="shared-tags" title={t("title")} description={t("description")}>
        <div className="space-y-5" data-testid="shared-tag-settings">
          {accounts.map((account) => (
            <SharedAccountTagEditor key={account.id} scope={{ loginId, accountId: account.id }} name={account.name} />
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}
