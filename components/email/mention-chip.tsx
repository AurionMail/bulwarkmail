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
          // The chip is a mailto: link that isn't editable, and Firefox
          // follows such links even inside the editor - asking which app
          // should write the mail. A click only selects it (and opens the
          // card); ProseMirror's selection doesn't rely on the default.
          handleDOMEvents: {
            click: (_view, event) => {
              if ((event.target as Element | null)?.closest?.("a.mention")) event.preventDefault();
              return false;
            },
            auxclick: (_view, event) => {
              if ((event.target as Element | null)?.closest?.("a.mention")) event.preventDefault();
              return false;
            },
          },
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

/**
 * The card for a mention chip: who it is, whether they're on the message,
 * and buttons to add them or remove the mention. Selecting the chip (a
 * click, a tap, or the keyboard) opens it; hovering only shows the chip is
 * clickable.
 */
export function MentionChipCard({ editor, recipients, findContacts, addsTo, onAdd }: MentionChipCardProps) {
  const t = useTranslations("email_composer");
  const [target, setTarget] = useState<ChipTarget | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setTarget(null), []);

  // Selecting a chip opens the card; moving the selection off it, or the
  // focus out of the editor, closes it. A press on the card's own buttons
  // keeps the focus in the editor.
  useEffect(() => {
    const onSelection = () => {
      const { selection } = editor.state;
      if (selection instanceof NodeSelection && selection.node.type.name === "mentionChip") {
        const element = editor.view.nodeDOM(selection.from);
        if (element instanceof HTMLElement) {
          setTarget({ pos: selection.from, element });
          return;
        }
      }
      setTarget(null);
    };
    editor.on("selectionUpdate", onSelection);
    editor.on("blur", close);
    return () => {
      editor.off("selectionUpdate", onSelection);
      editor.off("blur", close);
    };
  }, [editor, close]);

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
