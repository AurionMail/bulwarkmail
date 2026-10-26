"use client";

import React, { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey, TextSelection } from "@tiptap/pm/state";
import { Suggestion, exitSuggestion, type SuggestionMount, type SuggestionOptions } from "@tiptap/suggestion";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { MentionCandidate } from "@/lib/recipient-mentions";
import { MentionChip } from "@/components/email/mention-chip";

export const recipientMentionPluginKey = new PluginKey<{ active: boolean }>("recipientMention");

/**
 * Whether the "@" list is open in this editor. It owns Escape then, and the
 * composer, which handles Escape in the capture phase before the editor
 * sees it, has to let that one through.
 */
export function isRecipientMentionActive(editor: Editor | null | undefined): boolean {
  return !!editor && !editor.isDestroyed && !!recipientMentionPluginKey.getState(editor.state)?.active;
}

/**
 * Replaces the typed "@que" with a mention chip and a space. The label is
 * an attribute rendered as text, never parsed as HTML: it comes from
 * recipient display names, which a reply-all takes from the incoming message.
 */
export function insertMention(editor: Editor, range: Range, person: { label: string; email: string }) {
  const after = editor.state.doc.resolve(range.to).nodeAfter;
  const spaceFollows = !!after?.isText && /^\s/.test(after.text ?? "");
  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const marks = state.doc.resolve(range.from).marks();
      const chip = state.schema.nodes[MentionChip.name].create({ label: person.label, email: person.email });
      tr.replaceWith(range.from, range.to, spaceFollows ? chip : [chip, state.schema.text(" ", marks)]);
      // After the chip and its space, ready to go on typing.
      tr.setSelection(TextSelection.create(tr.doc, range.from + chip.nodeSize + 1));
      tr.scrollIntoView();
      return true;
    })
    .run();
}

export interface RecipientMentionOptions {
  /** Who an @ followed by `query` offers right now; asked on every keystroke. */
  getCandidates: (query: string) => MentionCandidate[];
  /** Called after a pick, so a contact who isn't a recipient yet can be added. */
  onPick?: (candidate: MentionCandidate) => void;
  render?: SuggestionOptions<MentionCandidate, MentionCandidate>["render"];
}

/**
 * "@" in the body offers the message's recipients, and contacts who can be
 * added as one, and inserts the chosen one's first name as a mention chip. The
 * suggestion is only active while someone matches what was typed, so an @
 * nobody matches leaves Enter and Escape to the editor and composer.
 */
export const RecipientMention = Extension.create<RecipientMentionOptions>({
  name: "recipientMention",
  // While the list is open its Enter, Tab and arrows go ahead of the list,
  // table and core keymaps, which run at the default priority (100).
  priority: 101,

  addExtensions() {
    return [MentionChip];
  },

  addOptions() {
    return {
      getCandidates: () => [],
      onPick: undefined,
      render: undefined,
    };
  },

  // Focus leaving the editor (Shift+Tab, another field) closes the list. Left
  // open, it would float over that field and keep Escape from the composer.
  onBlur() {
    if (isRecipientMentionActive(this.editor)) exitSuggestion(this.editor.view, recipientMentionPluginKey);
  },

  addProseMirrorPlugins() {
    const { getCandidates, onPick, render } = this.options;
    return [
      Suggestion<MentionCandidate, MentionCandidate>({
        editor: this.editor,
        pluginKey: recipientMentionPluginKey,
        char: "@",
        // Only at the start of a word, so info@example.com never triggers.
        allowedPrefixes: [" ", "\u00a0"],
        decorationClass: "recipient-mention-query",
        floatingUi: { strategy: "fixed" },
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code) return false;
          const code = state.schema.marks.code;
          if (code && state.doc.rangeHasMark(range.from, range.to, code)) return false;
          const query = state.doc.textBetween(range.from + 1, range.to);
          return getCandidates(query).length > 0;
        },
        items: ({ query }) => getCandidates(query),
        command: ({ editor, range, props }) => {
          insertMention(editor, range, props);
          onPick?.(props);
        },
        render,
      }),
    ];
  },
});

export interface RecipientMentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface RecipientMentionListProps {
  editor: Editor;
  items: MentionCandidate[];
  command: (item: MentionCandidate) => void;
  mount: SuggestionMount;
}

export const RecipientMentionList = forwardRef<RecipientMentionListHandle, RecipientMentionListProps>(
  function RecipientMentionList({ editor, items, command, mount }, ref) {
    const t = useTranslations("email_composer");
    const listId = useId();
    // Every keystroke brings new items; the highlight starts over with them.
    const [selection, setSelection] = useState({ items, index: 0 });
    const selected = selection.items === items ? selection.index : 0;
    const [position, setPosition] = useState<{ x: number; y: number; strategy: "absolute" | "fixed" } | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Anchored under the typed "@..." by the suggestion's own positioning,
    // which follows scrolling and resizing and dismisses on outside clicks.
    useLayoutEffect(() => {
      const element = listRef.current;
      if (!element) return;
      return mount(element, {
        onPosition: ({ x, y, strategy }) => {
          // Keep the list on screen in narrow panes.
          const maxX = window.innerWidth - element.offsetWidth - 8;
          setPosition({ x: Math.max(8, Math.min(x, maxX)), y, strategy });
        },
      });
    }, [mount]);

    useEffect(() => {
      listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
    }, [selected]);

    // The caret stays in the editor, so the editor points screen readers at
    // the list and its highlighted name, as the To/Cc autocomplete does for
    // its input. Removed again when the list closes.
    useEffect(() => {
      if (editor.isDestroyed) return;
      const dom = editor.view.dom;
      dom.setAttribute("aria-autocomplete", "list");
      dom.setAttribute("aria-controls", listId);
      return () => {
        dom.removeAttribute("aria-autocomplete");
        dom.removeAttribute("aria-controls");
        dom.removeAttribute("aria-activedescendant");
      };
    }, [editor, listId]);

    useEffect(() => {
      if (editor.isDestroyed) return;
      editor.view.dom.setAttribute("aria-activedescendant", `${listId}-${selected}`);
    }, [editor, listId, selected]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || items.length === 0) return false;
        if (event.key === "ArrowDown") {
          setSelection({ items, index: (selected + 1) % items.length });
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelection({ items, index: (selected + items.length - 1) % items.length });
          return true;
        }
        if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
          command(items[selected]);
          return true;
        }
        return false;
      },
    }), [items, selected, command]);

    return (
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={t("mention_recipients")}
        className="z-50 w-72 max-w-[calc(100vw-16px)] max-h-48 overflow-y-auto bg-background border border-border rounded-md shadow-lg"
        // A press anywhere on the list - its scrollbar too - keeps the focus
        // in the editor, which would otherwise close the list on blur.
        onMouseDown={(e) => e.preventDefault()}
        style={{
          position: position?.strategy ?? "fixed",
          left: position?.x ?? 0,
          top: position?.y ?? 0,
          visibility: position ? undefined : "hidden",
        }}
      >
        {items.map((item, i) => (
          <button
            key={item.email}
            id={`${listId}-${i}`}
            type="button"
            role="option"
            aria-selected={i === selected}
            className={cn(
              "w-full px-3 py-2 text-start text-sm flex items-center gap-2",
              i === selected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
            )}
            onMouseDown={(e) => {
              // Keep the editor focused and the typed "@..." in place.
              e.preventDefault();
              command(item);
            }}
          >
            <Avatar name={item.name} email={item.email} size="sm" className="shrink-0 w-6 h-6 text-[10px]" />
            {/* What will be inserted comes first: for "Nagy János" that may be
                the surname, which the full name alone would not show. */}
            <span className="font-medium shrink-0">@{item.label}</span>
            <span className="text-muted-foreground truncate">
              {item.name && item.name !== item.label ? `${item.name} · ${item.email}` : item.email}
            </span>
            {/* Picking a contact also adds them as a recipient; say so
                before it happens. */}
            {item.addsTo && (
              <span className="ms-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] bg-muted text-muted-foreground">
                + {t(item.addsTo)}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }
);
