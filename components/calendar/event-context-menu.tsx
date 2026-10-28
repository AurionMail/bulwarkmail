"use client";

import { useTranslations } from "next-intl";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  Pencil,
  CopyPlus,
  Copy,
  Download,
  Video,
  Link as LinkIcon,
  Trash2,
} from "@/components/icons";
import type { CalendarEvent } from "@/lib/jmap/types";
import { buildCalendarPath } from "@/lib/deep-links";
import { useCopyLink } from "@/hooks/use-copy-link";
import { findMeetingLink } from "@/lib/event-links";

interface Position {
  x: number;
  y: number;
}

interface EventContextMenuProps {
  event: CalendarEvent;
  position: Position;
  isOpen: boolean;
  onClose: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onEdit: () => void;
  onDuplicate: () => void;
  onExportICS: () => void;
  onCopyTitle: () => void;
  onCopyMeetingLink?: () => void;
  onDelete: () => void;
  /** False for an event the user can't change (a birthday, a subscription, a read-only share): no Edit or Delete. */
  editable?: boolean;
}

export function EventContextMenu({
  event,
  position,
  isOpen,
  onClose,
  menuRef,
  onEdit,
  onDuplicate,
  onExportICS,
  onCopyTitle,
  onCopyMeetingLink,
  onDelete,
  editable = true,
}: EventContextMenuProps) {
  const t = useTranslations("calendar");
  const tDeepLink = useTranslations("deep_link");
  const copyLink = useCopyLink();

  const handle = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const hasMeetingLink = !!findMeetingLink(event);

  return (
    <ContextMenu ref={menuRef} isOpen={isOpen} position={position} onClose={onClose}>
      {editable && <ContextMenuItem icon={Pencil} label={t("events.edit")} onClick={handle(onEdit)} />}
      <ContextMenuItem icon={CopyPlus} label={t("events.duplicate")} onClick={handle(onDuplicate)} />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={Download}
        label={t("events.export_ics")}
        onClick={handle(onExportICS)}
      />
      <ContextMenuItem
        icon={Copy}
        label={t("events.copy_title")}
        onClick={handle(onCopyTitle)}
      />
      {hasMeetingLink && onCopyMeetingLink && (
        <ContextMenuItem
          icon={Video}
          label={t("events.copy_link")}
          onClick={handle(onCopyMeetingLink)}
        />
      )}
      {/* Permalink into Bulwark (#733) - distinct from the meeting URL above,
          which points at whatever conferencing tool the organiser used. */}
      <ContextMenuItem
        icon={LinkIcon}
        label={tDeepLink("copy_event")}
        onClick={handle(() => {
          void copyLink(buildCalendarPath({
            view: "month",
            date: null,
            eventId: event.id,
            accountId: event.accountId,
          }));
        })}
      />
      {editable && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={Trash2}
            label={t("events.delete")}
            onClick={handle(onDelete)}
            destructive
          />
        </>
      )}
    </ContextMenu>
  );
}
