"use client";

import { useTranslations } from "next-intl";
import { Archive, Ban, File, Folder, Inbox, Send, Trash2, type AppIcon } from "@/components/icons";
import { localizeMailboxName } from "@/lib/mailbox-label";
import type { MailboxNode } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** A folder's icon in a Move list, the sidebar's for the folders with a role. */
export function moveMailboxIcon(role?: string | null): AppIcon {
  switch (role) {
    case "inbox": return Inbox;
    case "sent": return Send;
    case "drafts": return File;
    case "trash": return Trash2;
    case "junk": return Ban;
    case "archive": return Archive;
    default: return Folder;
  }
}

interface MoveTargetListProps {
  /** From buildMoveTargets. */
  tree: MailboxNode[];
  targetIds: Set<string>;
  onPick: (mailboxId: string) => void;
  /** `menu` for a dropdown, `panel` for the phone's full-width panel (44px rows). */
  variant?: "menu" | "panel";
}

/**
 * The folders a message can be moved to, as the reader's Move dropdown, its ⋮
 * and the phone panel show them: the names the sidebar shows (localized
 * Sent, Spam, Trash), subfolders indented on the reading side.
 */
export function MoveTargetList({ tree, targetIds, onPick, variant = "menu" }: MoveTargetListProps) {
  const tSidebar = useTranslations("sidebar");
  const panel = variant === "panel";
  const indent = (depth: number) => `${(panel ? 1 : 0.75) + depth}rem`;

  const render = (nodes: MailboxNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const Icon = moveMailboxIcon(node.role);
      const label = localizeMailboxName(node.role, node.name, (key) => tSidebar(`mailboxes.${key}`));
      const rowClass = panel
        ? "w-full pe-4 py-2.5 min-h-[44px] text-sm text-start flex items-center gap-3"
        : "w-full pe-3 py-1.5 text-sm text-start flex items-center gap-2 pointer-coarse:min-h-11";
      const icon = <Icon className={cn(panel ? "w-5 h-5" : "w-4 h-4", "flex-shrink-0")} />;
      return (
        <div key={node.id}>
          {targetIds.has(node.id) ? (
            <button
              type="button"
              role="menuitem"
              data-mailbox-id={node.id}
              onClick={() => onPick(node.id)}
              className={cn(rowClass, "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none")}
              style={{ paddingInlineStart: indent(depth) }}
              title={label}
            >
              {icon}
              <span className="truncate" dir="auto">{label}</span>
            </button>
          ) : (
            <div className={cn(rowClass, "text-muted-foreground")} style={{ paddingInlineStart: indent(depth) }}>
              {icon}
              <span className="truncate" dir="auto" title={label}>{label}</span>
            </div>
          )}
          {node.children.length > 0 && render(node.children, depth + 1)}
        </div>
      );
    });

  return <>{render(tree, 0)}</>;
}
