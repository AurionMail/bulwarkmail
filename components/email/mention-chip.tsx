"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Node, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { useTranslations } from "next-intl";
import { X } from "@/components/icons";
import { RecipientCard, recipientCardClass } from "@/components/email/recipient-popover";
import { mentionFromLink, mentionHref, type MentionCandidate, type MentionContact } from "@/lib/recipient-mentions";

/**
 * Addresses on the message (To and Cc) that mentions are checked against;
 * null while unknown, which marks nobody.
 */
export const mentionRecipientsKey = new PluginKey<Set<string> | null>("mentionRecipients");

/** Tells the editor who is on the message, so chips of anyone else stand out. */
export function setMentionRecipients(editor: Editor, emails: string[] | null) {
  if (editor.isDestroyed) return;
  const next = emails ? new Set(emails.map((e) => e.trim().toLowerCase())) : null;
  const current = mentionRecipientsKey.getState(editor.state);
  if (current === next || (current && next && current.size === next.size && [...next].every((e) => current.has(e)))) return;
  editor.view.dispatch(editor.state.tr.setMeta(mentionRecipientsKey, next).setMeta("addToHistory", false));
}

/**
 * An @mention in the body: one inline unit, deleted and selected as a
 * whole. In the sent message it is a mailto: link reading "@Name", which
 * every client shows as a link to the person.
 */
export const MentionChip = Node.create({
  name: "mentionChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      label: { default: "", rendered: false },
      email: { default: "", rendered: false },
    };
  },

  parseHTML() {
    return [{
      tag: "a[href]",
      // Ahead of the link mark, which would otherwise keep it as a plain link.
      priority: 60,
      getAttrs: (element) => mentionFromLink(element as HTMLElement) ?? false,
    }];
  },

  renderHTML({ node }) {
    // The label is a text node here, never markup: it comes from display
    // names, which a reply-all takes from the incoming message.
    return ["a", { href: mentionHref(node.attrs.email as string), class: "mention" }, `@${node.attrs.label as string}`];
  },

  renderText({ node }) {
    return `@${node.attrs.label as string}`;
  },

  addProseMirrorPlugins() {
    const type = this.name;
    return [
      new Plugin<Set<string> | null>({
        key: mentionRecipientsKey,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const next = tr.getMeta(mentionRecipientsKey) as Set<string> | null | undefined;
            return next === undefined ? value : next;
          },
        },
        props: {
          decorations(state) {
            const recipients = mentionRecipientsKey.getState(state);
            if (!recipients) return null;
            const marked: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === type && !recipients.has(String(node.attrs.email).toLowerCase())) {
                marked.push(Decoration.node(pos, pos + node.nodeSize, { class: "mention-outside" }));
              }
            });
            return marked.length ? DecorationSet.create(state.doc, marked) : null;
          },
        },
      }),
    ];
  },
});

interface ChipTarget {
  pos: number;
  element: HTMLElement;
  /** Opened by selecting the chip (click, tap, keyboard), not by hovering. */
  pinned: boolean;
}

interface MentionChipCardProps {
  editor: Editor;
  /** The message's To and Cc; undefined when mentions are off. */
  recipients?: MentionCandidate[];
  /** Looks up the full name of someone who isn't a recipient. */
  findContacts?: (query: string) => MentionContact[];
  /** The field "Add" puts someone in. */
  addsTo: "to" | "cc";
  onAdd?: (candidate: MentionCandidate) => void;
}

const HOVER_DELAY = 300;
const LEAVE_DELAY = 150;

/**
 * The card for a mention chip: who it is, whether they're on the message,
 * and buttons to add them or remove the mention. Hovering a chip shows it;
 * selecting the chip (a click or tap) keeps it open.
 */
export function MentionChipCard({ editor, recipients, findContacts, addsTo, onAdd }: MentionChipCardProps) {
  const t = useTranslations("email_composer");
  const [target, setTarget] = useState<ChipTarget | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const close = useCallback(() => {
    clearTimer();
    setTarget(null);
  }, []);

  // Hover: open after a short pause, close a moment after leaving the chip
  // unless the pointer moved onto the card.
  useEffect(() => {
    if (editor.isDestroyed) return;
    const dom = editor.view.dom;
    const chipAt = (node: EventTarget | null) =>
      node instanceof Element ? node.closest<HTMLElement>("a.mention") : null;
    const onOver = (event: MouseEvent) => {
      const element = chipAt(event.target);
      if (!element || !dom.contains(element)) return;
      clearTimer();
      timer.current = setTimeout(() => {
        if (editor.isDestroyed) return;
        const pos = editor.view.posAtDOM(element, 0);
        setTarget((current) => current?.pinned ? current : { pos, element, pinned: false });
      }, HOVER_DELAY);
    };
    const onOut = (event: MouseEvent) => {
      if (!chipAt(event.target) || chipAt(event.relatedTarget)) return;
      clearTimer();
      timer.current = setTimeout(() => {
        setTarget((current) => current?.pinned ? current : null);
      }, LEAVE_DELAY);
    };
    dom.addEventListener("mouseover", onOver);
    dom.addEventListener("mouseout", onOut);
    return () => {
      dom.removeEventListener("mouseover", onOver);
      dom.removeEventListener("mouseout", onOut);
      clearTimer();
    };
  }, [editor]);

  // Selecting a chip pins the card; moving the selection off it closes it.
  useEffect(() => {
    const onSelection = () => {
      const { selection } = editor.state;
      if (selection instanceof NodeSelection && selection.node.type.name === "mentionChip") {
        const element = editor.view.nodeDOM(selection.from);
        if (element instanceof HTMLElement) {
          clearTimer();
          setTarget({ pos: selection.from, element, pinned: true });
          return;
        }
      }
      setTarget((current) => current?.pinned ? null : current);
    };
    // A blur closes it too, but not a press on the card's own buttons,
    // which keep the focus in the editor.
    const onBlur = () => setTarget((current) => current?.pinned ? null : current);
    editor.on("selectionUpdate", onSelection);
    editor.on("blur", onBlur);
    return () => {
      editor.off("selectionUpdate", onSelection);
      editor.off("blur", onBlur);
    };
  }, [editor]);

  // The chip it belongs to went away (deleted, undone): close.
  useEffect(() => {
    if (!target) return;
    const onUpdate = () => {
      if (!target.element.isConnected) close();
    };
    editor.on("update", onUpdate);
    return () => { editor.off("update", onUpdate); };
  }, [editor, target, close]);

  // Under the chip, kept on screen, following scrolling.
  useLayoutEffect(() => {
    if (!target) {
      setPosition(null);
      return;
    }
    const place = () => {
      const card = cardRef.current;
      if (!target.element.isConnected) return;
      const rect = target.element.getBoundingClientRect();
      const width = card?.offsetWidth ?? 0;
      const height = card?.offsetHeight ?? 0;
      const x = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = rect.bottom + 4;
      const y = below + height > window.innerHeight - 8 && rect.top - height - 4 > 8 ? rect.top - height - 4 : below;
      setPosition({ x, y });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [target]);

  if (!target || editor.isDestroyed) return null;
  const node = editor.state.doc.nodeAt(target.pos);
  if (!node || node.type.name !== "mentionChip") return null;

  const label = node.attrs.label as string;
  const email = node.attrs.email as string;
  const key = email.toLowerCase();
  const recipient = recipients?.find((r) => r.email.toLowerCase() === key);
  const contact = recipient ? undefined : findContacts?.(email).find((c) => c.email.toLowerCase() === key);
  const name = recipient?.name || contact?.name || label;
  const outside = !!recipients && !recipient;

  const remove = () => {
    const from = target.pos;
    // The space inserted after the chip goes with it.
    const next = editor.state.doc.textBetween(from + node.nodeSize, Math.min(from + node.nodeSize + 1, editor.state.doc.content.size));
    const to = from + node.nodeSize + (next === " " ? 1 : 0);
    close();
    editor.chain().focus().deleteRange({ from, to }).run();
  };

  const add = () => {
    onAdd?.({ label, name: name !== label ? name : undefined, email, addsTo });
    if (!target.pinned) close();
  };

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={name}
      data-testid="mention-card"
      className={recipientCardClass}
      style={{
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        visibility: position ? undefined : "hidden",
      }}
      // Pressing a button keeps the focus (and the chip's selection) in the editor.
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={clearTimer}
      onMouseLeave={() => {
        if (target.pinned) return;
        clearTimer();
        timer.current = setTimeout(close, LEAVE_DELAY);
      }}
    >
      <RecipientCard
        name={name !== label ? name : undefined}
        email={email}
        actions={
          <button
            type="button"
            onClick={remove}
            className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded hover:bg-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            {t("mention_card_remove")}
          </button>
        }
      >
        {outside && (
          <div className="space-y-2">
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("mention_card_not_recipient")}</p>
            {onAdd && (
              <button
                type="button"
                onClick={add}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("mention_card_add", { field: t(addsTo) })}
              </button>
            )}
          </div>
        )}
      </RecipientCard>
    </div>,
    document.body,
  );
}
