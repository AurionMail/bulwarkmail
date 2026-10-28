"use client";

import { useTranslations } from "next-intl";
import { ArrowUpDown, Check } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { ContextMenu, ContextMenuSeparator } from "@/components/ui/context-menu";
import { useContextMenu } from "@/hooks/use-context-menu";
import { useSettingsStore, getMessageListOrderFor } from "@/stores/settings-store";
import { usePolicyStore } from "@/stores/policy-store";
import { useAuthStore } from "@/stores/auth-store";
import { useEmailStore } from "@/stores/email-store";
import { isDefaultOrder, sanitizeSortLevels, type SortLevel } from "@/lib/message-list-order";
import { cn } from "@/lib/utils";

/** The orders the list header offers; Settings has the full editor. */
export const SORT_CHOICES = [
  { key: "newest", levels: [] },
  { key: "oldest", levels: [{ criterion: "receivedAt", direction: "asc" }] },
  { key: "unread", levels: [{ criterion: "unread", direction: "desc" }], keyword: true },
  { key: "starred", levels: [{ criterion: "starred", direction: "desc" }], keyword: true },
  { key: "sender", levels: [{ criterion: "from", direction: "asc" }] },
  { key: "subject", levels: [{ criterion: "subject", direction: "asc" }] },
  { key: "largest", levels: [{ criterion: "size", direction: "desc" }] },
] as const satisfies ReadonlyArray<{ key: string; levels: readonly SortLevel[]; keyword?: boolean }>;

export type SortChoiceKey = (typeof SORT_CHOICES)[number]["key"];

/** The choice `levels` is, or null for an order only Settings can make. */
export function sortChoiceFor(levels: SortLevel[]): SortChoiceKey | null {
  // A trailing newest-first level is implicit (see detectPreset).
  const last = levels[levels.length - 1];
  const core = levels.length > 1 && last.criterion === "receivedAt" && last.direction === "desc"
    ? levels.slice(0, -1)
    : levels;
  if (isDefaultOrder(core)) return "newest";
  if (core.length !== 1) return null;
  const match = SORT_CHOICES.find((choice) =>
    choice.levels.length === 1
    && choice.levels[0].criterion === core[0].criterion
    && choice.levels[0].direction === core[0].direction);
  return match?.key ?? null;
}

/**
 * Picks an order for the list. It writes the "Message list order" setting, so
 * Settings and every device agree. That setting applies to the Inbox only
 * unless "Apply to all folders" is on; picked in another folder, it turns
 * that on, or the pick would do nothing there.
 */
export function applySortChoice(key: SortChoiceKey, folderRole: string | null | undefined): void {
  const choice = SORT_CHOICES.find((c) => c.key === key);
  if (!choice) return;
  const { updateSetting, messageListOrderScope } = useSettingsStore.getState();
  updateSetting("messageListOrder", sanitizeSortLevels(choice.levels.map((level) => ({ ...level }))));
  if (messageListOrderScope === "inbox" && folderRole !== "inbox" && choice.levels.length > 0) {
    updateSetting("messageListOrderScope", "all");
  }
  const client = useAuthStore.getState().client;
  const store = useEmailStore.getState();
  if (client && store.selectedMailbox) void store.fetchEmails(client, store.selectedMailbox, { background: true });
}

/** The list header's Sort button (MAIL-30), like the one in Files. */
export function MailSortMenu({ folderRole, disabled, className }: { folderRole: string | null | undefined; disabled?: boolean; className?: string }) {
  const t = useTranslations("email_list.sort");
  const menu = useContextMenu<null>();
  const hidden = usePolicyStore((s) => s.isSettingHidden("messageListOrder"));
  const locked = usePolicyStore((s) => s.isSettingLocked("messageListOrder"));
  // Re-render when the order changes elsewhere (Settings, another device).
  useSettingsStore((s) => s.messageListOrder);
  useSettingsStore((s) => s.messageListOrderScope);
  const client = useAuthStore((s) => s.client);
  if (hidden) return null;

  const current = sortChoiceFor(getMessageListOrderFor(folderRole));
  // A server without hasKeyword can't order by read state or stars.
  const sortOptions = client?.getEmailQuerySortOptions?.() ?? null;
  const keywordSort = sortOptions === null || sortOptions.includes("hasKeyword");

  return (
    <>
      <IconButton
        label={t("title")}
        aria-haspopup="menu"
        aria-expanded={menu.contextMenu.isOpen}
        disabled={disabled || locked}
        className={cn(menu.contextMenu.isOpen && "bg-accent", className)}
        data-testid="mail-sort"
        onMouseDown={(e) => { if (menu.contextMenu.isOpen) e.stopPropagation(); }}
        onClick={(e) => {
          if (menu.contextMenu.isOpen) menu.closeContextMenu();
          else menu.openContextMenuFrom(e.currentTarget, null, "end");
        }}
      >
        <ArrowUpDown />
      </IconButton>
      <ContextMenu ref={menu.menuRef} isOpen={menu.contextMenu.isOpen} position={menu.contextMenu.position} onClose={menu.closeContextMenu}>
        {SORT_CHOICES.filter((choice) => keywordSort || !("keyword" in choice)).map((choice) => (
          <SortItem
            key={choice.key}
            label={t(choice.key)}
            checked={current === choice.key}
            testId={`mail-sort-${choice.key}`}
            onClick={() => {
              menu.closeContextMenu();
              applySortChoice(choice.key, folderRole);
            }}
          />
        ))}
        {current === null && (
          <>
            <ContextMenuSeparator />
            <SortItem label={t("custom")} checked onClick={menu.closeContextMenu} />
          </>
        )}
      </ContextMenu>
    </>
  );
}

/** A checkable entry of the Sort menu, as in Files'. */
function SortItem({ label, checked, onClick, testId }: { label: string; checked: boolean; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      data-testid={testId}
      onClick={onClick}
      className="w-full px-3 py-1.5 max-md:min-h-11 text-sm text-start flex items-center gap-2 hover:bg-muted focus:outline-none focus-visible:bg-muted"
    >
      <span className="w-4 h-4 shrink-0 flex items-center justify-center">
        {checked && <Check className="w-4 h-4" />}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  );
}
