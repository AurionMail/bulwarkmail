// Shared helper for global key listeners to decide whether a keyboard event
// originated from a typing context (input, textarea, select, contentEditable).
//
// Checking `document.activeElement` / `event.target` is NOT enough: inside a
// shadow root both are retargeted to the host element, so the QuotedHtml
// island's inner contentEditable (components/email/quoted-html.ts) looks like
// a plain <div> from outside. Single-key mailbox shortcuts then fire while the
// user is editing quoted text — up to and including deleting the open email on
// Backspace (#654). `composedPath()` sees through the shadow boundary and
// starts at the real inner target, so it is the reliable signal.
export function isEditableEventTarget(event: Event): boolean {
  const path =
    typeof event.composedPath === "function"
      ? event.composedPath()
      : [event.target];
  return path.some((node) => {
    if (!(node instanceof HTMLElement)) return false;
    const tag = node.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (node.isContentEditable) return true;
    // jsdom (tests) doesn't implement isContentEditable; browsers reflect the
    // property into the attribute, so this also covers "plaintext-only".
    const attr = node.getAttribute("contenteditable");
    return attr === "" || attr === "true" || attr === "plaintext-only";
  });
}

/**
 * Whether a key event comes from a control that Enter or Space activates
 * itself (a link, a button): a page-wide shortcut on those keys must leave it
 * alone, or a focused "Skip to message list" link opens a message instead.
 */
export function isActivatableEventTarget(event: Event): boolean {
  const path =
    typeof event.composedPath === "function"
      ? event.composedPath()
      : [event.target];
  return path.some(
    (node) =>
      node instanceof HTMLElement &&
      node.matches('a[href], button, summary, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="option"], [role="tab"], [role="switch"]'),
  );
}
