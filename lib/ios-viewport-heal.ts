/**
 * Works around an iOS WebKit bug in installed (standalone) web apps: after
 * the app comes back from the background, or after the keyboard closes, the
 * viewport sometimes stays shorter than the screen. Every app shell is
 * `h-dvh`, so the bottom navigation floats above a strip of bare body
 * background until the app is force-quit (#1226).
 *
 * WebKit re-measures the viewport when the full-height content is laid out
 * from scratch, so when the viewport is shorter than the tallest height seen
 * at the same width, hide and show the body once and restore scroll offsets.
 */

type StandaloneNavigator = Navigator & { standalone?: boolean };

const SETTLE_MS = 150;
const TOLERANCE_PX = 4;

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** Re-lay out the page from scratch, keeping every scroll offset. */
export function relayoutBody(doc: Document = document): void {
  const scrolled: Array<[Element, number, number]> = [];
  doc.body.querySelectorAll("*").forEach((el) => {
    if (el.scrollTop || el.scrollLeft) scrolled.push([el, el.scrollTop, el.scrollLeft]);
  });
  const body = doc.body;
  const prev = body.style.display;
  body.style.display = "none";
  void body.offsetHeight;
  body.style.display = prev;
  for (const [el, top, left] of scrolled) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
}

/**
 * Starts watching for a shrunken viewport. No-op outside an iOS home-screen
 * app (`navigator.standalone` only exists on iOS). Returns a cleanup function.
 */
export function startIosViewportHeal(win: Window = window): () => void {
  if ((win.navigator as StandaloneNavigator).standalone !== true) return () => {};

  const doc = win.document;
  // Keyed by width so rotating the device does not count as shrinking.
  const tallest = new Map<number, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const record = () => {
    const w = win.innerWidth;
    tallest.set(w, Math.max(tallest.get(w) ?? 0, win.innerHeight));
  };

  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (doc.visibilityState !== "visible") return;
      // Hiding the body would close the keyboard of a focused field.
      if (isEditable(doc.activeElement)) return;
      const max = tallest.get(win.innerWidth) ?? 0;
      if (win.innerHeight < max - TOLERANCE_PX) relayoutBody(doc);
      record();
    }, SETTLE_MS);
  };

  const onVisibility = () => {
    if (doc.visibilityState === "visible") check();
  };

  record();
  win.addEventListener("resize", record);
  win.addEventListener("pageshow", check);
  doc.addEventListener("visibilitychange", onVisibility);
  doc.addEventListener("focusout", check);

  return () => {
    clearTimeout(timer);
    win.removeEventListener("resize", record);
    win.removeEventListener("pageshow", check);
    doc.removeEventListener("visibilitychange", onVisibility);
    doc.removeEventListener("focusout", check);
  };
}
