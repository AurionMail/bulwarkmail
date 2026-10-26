"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FileText, FileSpreadsheet, FileImage, FileArchive, File as FileIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { stripBidiControls } from "@/lib/bidi";
import type { Attachment, Email } from "@/lib/jmap/types";
import type { LoadListAttachments } from "@/lib/list-attachments";

/**
 * A message can carry a dozen inline images — signature logos, tracking
 * pixels, spacers a couple of hundred bytes each — none of which anyone
 * wants to download. Only parts the sender actually attached belong in
 * the list, so anything marked inline or referenced by a Content-ID is
 * dropped.
 */
export function realAttachments(attachments?: Attachment[]): Attachment[] {
  if (!attachments?.length) return [];
  return attachments.filter(
    (a) => a.disposition !== "inline" && !a.cid && !!a.name,
  );
}

// `badge` fills the square Mountain View draws behind a white glyph, as Gmail does.
const ICON_BY_TYPE: { match: RegExp; icon: typeof FileIcon; className: string; badge: string }[] = [
  { match: /^image\//, icon: FileImage, className: "text-violet-600 dark:text-violet-400", badge: "bg-red-600" },
  { match: /pdf/, icon: FileText, className: "text-red-600 dark:text-red-400", badge: "bg-red-600" },
  { match: /sheet|excel|csv/, icon: FileSpreadsheet, className: "text-emerald-600 dark:text-emerald-400", badge: "bg-emerald-600" },
  { match: /zip|compress|tar|rar|7z/, icon: FileArchive, className: "text-amber-600 dark:text-amber-400", badge: "bg-zinc-500" },
  { match: /word|document|rtf|text\//, icon: FileText, className: "text-sky-600 dark:text-sky-400", badge: "bg-blue-600" },
];

function iconFor(type: string, name: string) {
  const probe = `${type || ""} ${name || ""}`.toLowerCase();
  return ICON_BY_TYPE.find((e) => e.match.test(probe)) ?? { icon: FileIcon, className: "text-muted-foreground", badge: "bg-zinc-500" };
}

/** Long names are unreadable truncated at the tail — the extension is the
 *  most identifying part, so keep it and elide the middle. */
function shortName(name: string, max = 18): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  const head = name.slice(0, Math.max(1, max - ext.length - 1));
  return `${head}…${ext}`;
}

// Shared by the chips, the space a loading row holds for them and the
// verification-code chip, so all of them are the same height.
export const CHIP_BOX_CLASS = "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs";
export const CHIP_ICON_CLASS = "h-3.5 w-3.5 flex-shrink-0";

// Mountain View's chips are Gmail's: a pill with a filled square in front.
export const MV_CHIP_BOX_CLASS = "inline-flex h-8 items-center gap-2 rounded-full border border-border ps-3 pe-4 text-sm";
export const MV_CHIP_BADGE_CLASS = "inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[3px] text-white";
export const MV_CHIP_BADGE_ICON_CLASS = "h-3 w-3";

export type ChipVariant = "default" | "mountain-view";

interface AttachmentChipsProps {
  attachments?: Attachment[];
  onOpen: (attachment: Attachment) => void;
  /** How many chips to show before collapsing the rest into a count. */
  max?: number;
  /** A chip drawn ahead of the attachments in the same row (the verification code). */
  leading?: ReactNode;
  variant?: ChipVariant;
  className?: string;
}

export function AttachmentChips({ attachments, onOpen, max = 2, leading, variant = "default", className }: AttachmentChipsProps) {
  const mv = variant === "mountain-view";
  const real = realAttachments(attachments);
  if (!real.length && !leading) return null;

  // Next to a leading chip one attachment is all that still fits on the line.
  const shown = real.slice(0, leading ? Math.min(max, 1) : max);
  const overflow = real.length - shown.length;

  return (
    <div className={cn("flex items-center flex-wrap", mv ? "gap-2" : "gap-1.5", className)}>
      {leading}
      {shown.map((a) => {
        const { icon: Icon, className: iconClass, badge } = iconFor(a.type, a.name ?? "");
        return (
          <button
            key={a.blobId + a.partId}
            type="button"
            // The row itself opens the message; a chip must not do both.
            onClick={(e) => { e.stopPropagation(); onOpen(a); }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={stripBidiControls(a.name ?? "")}
            className={mv
              ? cn(MV_CHIP_BOX_CLASS, "max-w-[14rem] bg-transparent text-foreground/80 hover:bg-muted")
              : cn(CHIP_BOX_CLASS, "max-w-[12rem] bg-background/60 text-foreground/80 hover:bg-muted hover:text-foreground")}
          >
            {mv ? (
              <span className={cn(MV_CHIP_BADGE_CLASS, badge)}>
                <Icon className={MV_CHIP_BADGE_ICON_CLASS} />
              </span>
            ) : (
              <Icon className={cn(CHIP_ICON_CLASS, iconClass)} />
            )}
            <span className="truncate">{shortName(stripBidiControls(a.name ?? ""))}</span>
          </button>
        );
      })}
      {overflow > 0 && (
        <span className={cn(
          "border border-border text-muted-foreground tabular-nums",
          mv ? "inline-flex h-8 items-center rounded-full px-3 text-sm" : "rounded-md px-1.5 py-0.5 text-xs",
        )}>
          +{overflow}
        </span>
      )}
    </div>
  );
}

/**
 * Attachment parts for a list row. List requests no longer carry
 * `attachments` (#1089), so a row with a paperclip loads its own once it is
 * mounted; an email that already has them (thread expansion, demo data) is
 * used as is. `undefined` while the answer is still out.
 */
export function useListAttachments(email: Email, load?: LoadListAttachments): Attachment[] | undefined {
  const needsLoad = !!load && !!email.hasAttachment && !email.attachments;
  // The list unmounts rows that scroll away. One that comes back finds its
  // answer cached and takes it in the first render, so it mounts at its full
  // height instead of growing a frame later and making the list correct
  // the scroll position under the reader.
  const [loaded, setLoaded] = useState<{ id: string; attachments: Attachment[] } | null>(() => {
    const cached = needsLoad ? load?.peek?.(email) : undefined;
    return cached ? { id: email.id, attachments: cached } : null;
  });

  useEffect(() => {
    if (!needsLoad || !load) return;
    const id = email.id;
    let answered = false;
    const cancel = load(email, (attachments) => {
      answered = true;
      setLoaded((prev) => prev?.id === id && prev.attachments === attachments ? prev : { id, attachments });
    });
    // The peek ran during render, before the list's owner had caught up with
    // a view change, so it may have read another account's entry for the
    // same id. The loader's answer is the real one; without one yet, wait.
    if (!answered) setLoaded(null);
    return cancel;
    // The row's email object is replaced on every keyword change; only a
    // different message needs a different answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsLoad, load, email.id]);

  if (email.attachments) return email.attachments;
  return loaded?.id === email.id ? loaded.attachments : undefined;
}

/**
 * Whether a list row shows the paperclip. Stalwart sets `hasAttachment` for
 * inline images too (a logo in a notification mail), which the viewer never
 * lists, so once the parts are in the flag only counts if one of them is a
 * real attachment. Until then the server's flag stands.
 */
export function useListHasAttachment(email: Email, load?: LoadListAttachments): boolean {
  const attachments = useListAttachments(email, load);
  if (!email.hasAttachment) return false;
  return attachments === undefined || realAttachments(attachments).length > 0;
}

/**
 * Whether a list row will draw a chip row for this email, counting the room
 * it holds while the parts load. Lets the list estimate a row's height
 * before it has measured it.
 */
export function listRowShowsChips(email: Email, load?: LoadListAttachments): boolean {
  if (email.attachments) return realAttachments(email.attachments).length > 0;
  return !!load && !!email.hasAttachment;
}

interface ListAttachmentChipsProps extends Omit<AttachmentChipsProps, "attachments"> {
  email: Email;
  load?: LoadListAttachments;
}

export function ListAttachmentChips({ email, load, ...chipProps }: ListAttachmentChipsProps) {
  const attachments = useListAttachments(email, load);
  if (attachments === undefined && load && email.hasAttachment) {
    // Hold a chip's height until the parts arrive, so the row does not grow
    // under the reader when they do. A leading chip holds it just as well.
    if (chipProps.leading) {
      return <div className={cn("flex items-center gap-1.5", chipProps.className)}>{chipProps.leading}</div>;
    }
    return (
      <div aria-hidden className={cn("flex", chipProps.className)}>
        <span className={cn(chipProps.variant === "mountain-view" ? MV_CHIP_BOX_CLASS : CHIP_BOX_CLASS, "invisible")}>
          <span className={chipProps.variant === "mountain-view" ? MV_CHIP_BADGE_CLASS : CHIP_ICON_CLASS} />
          <span>&nbsp;</span>
        </span>
      </div>
    );
  }
  return <AttachmentChips attachments={attachments} {...chipProps} />;
}
