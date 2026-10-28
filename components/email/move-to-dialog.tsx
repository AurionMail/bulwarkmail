"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import type { Email, Mailbox } from "@/lib/jmap/types";
import { buildMoveTargets, resolveMoveOwnerAccountId } from "@/lib/move-targets";
import { MoveTargetList } from "./move-target-list";

interface MoveToDialogProps {
  /** The message to move; the dialog is open while it is set. */
  email: Email | null;
  mailboxes: Mailbox[];
  selectedMailbox: string;
  onClose: () => void;
  onMove: (mailboxId: string) => void;
}

/**
 * "Move to…" from the command palette: the same folder list as the reader's
 * Move menu (the message's own account first), in a dialog.
 */
export function MoveToDialog({ email, mailboxes, selectedMailbox, onClose, onMove }: MoveToDialogProps) {
  const t = useTranslations("context_menu");
  const { tree, targetIds } = useMemo(
    () => buildMoveTargets(mailboxes, {
      currentMailboxId: selectedMailbox,
      ownerAccountId: resolveMoveOwnerAccountId(email, mailboxes, selectedMailbox),
    }),
    [email, mailboxes, selectedMailbox],
  );
  return (
    <Dialog isOpen={!!email} onClose={onClose} title={t("move_to_dialog")} bodyClassName="px-2" size="sm">
      <div role="menu" aria-label={t("move_to_dialog")} className="max-h-[60vh] overflow-y-auto">
        <MoveTargetList
          tree={tree}
          targetIds={targetIds}
          onPick={(mailboxId) => {
            onClose();
            onMove(mailboxId);
          }}
        />
      </div>
    </Dialog>
  );
}
