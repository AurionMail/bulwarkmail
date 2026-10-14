/**
 * Runs `fn` in a task of its own, once the current one has ended.
 *
 * Chromium hands a fetch() to the network only when the task that called it
 * yields, so a request issued from a click or key handler otherwise leaves
 * the browser after the handler's whole synchronous render pass: tens of
 * milliseconds for a tree this size. Issuing the request first and writing
 * the state that only paints a loading indicator from here lets the round
 * trip overlap that rendering instead of following it. Outside a browser it
 * runs `fn` at once.
 */
export function afterRequestDispatch(fn: () => void): void {
  if (typeof window === 'undefined') {
    fn();
    return;
  }
  window.setTimeout(fn, 0);
}
