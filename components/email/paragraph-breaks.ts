import { SIGNATURE_RANGE_MARKER } from "@/components/email/signature-block";

/**
 * Empty lines in the composer (#1015).
 *
 * The composer writes one paragraph per line, so a blank line is an empty
 * paragraph. ProseMirror serializes that as `<p></p>`, which a browser or mail
 * client renders zero pixels high: the blank lines vanished for the recipient
 * and in the Sent folder. Browsers only show a block's last line when it holds
 * something, which is why Gmail and Thunderbird write `<p><br></p>`.
 *
 * The rule here mirrors the browser's: a <br> at the very end of a paragraph
 * doesn't show. On the way out every paragraph that is empty or ends in a line
 * break gets that extra <br>; on the way back in (re-opened draft, signature
 * swap) the parse rule below drops it again, so the editor content round-trips
 * without gaining a line each time.
 */

function lastChild(el: Element): ChildNode | null {
  let node = el.lastChild;
  while (node && node.nodeType === 3 && !(node.textContent ?? "").trim()) {
    node = node.previousSibling;
  }
  return node;
}

/**
 * Add the trailing <br> to every paragraph under `root` that would otherwise
 * lose its last line. The signature's range marker paragraphs stay as they
 * are: they only bracket the signature for the composer.
 */
export function addTrailingParagraphBreaks(root: ParentNode): void {
  root.querySelectorAll("p").forEach((p) => {
    if (p.hasAttribute(SIGNATURE_RANGE_MARKER)) return;
    const last = lastChild(p);
    if (!last || last.nodeName === "BR") {
      p.appendChild(p.ownerDocument.createElement("br"));
    }
  });
}

/** Whether `el` is the <br> a paragraph ends on, which a browser doesn't show. */
export function isTrailingParagraphBreak(el: HTMLElement): boolean {
  if (el.parentElement?.nodeName !== "P") return false;
  return lastChild(el.parentElement) === el;
}

/**
 * Parse rule for the paragraph node: skip the invisible trailing <br> instead
 * of turning it into a hard break. Ranks above the hard break's own rule.
 */
export const trailingParagraphBreakRule = {
  tag: "br",
  priority: 60,
  ignore: true,
  getAttrs: (el: HTMLElement) => (isTrailingParagraphBreak(el) ? null : false),
} as const;
