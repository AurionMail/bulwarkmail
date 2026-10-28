import { useEffect, useRef } from 'react';

// The traps that are active, the one opened last at the end. Only that one
// answers Escape, so a dialog over a dialog closes alone.
const activeTraps: object[] = [];

interface UseFocusTrapOptions {
  isActive: boolean;
  onEscape?: () => void;
  restoreFocus?: boolean;
}

export function useFocusTrap({
  isActive,
  onEscape,
  restoreFocus = true,
}: UseFocusTrapOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  // Callers pass a new onEscape on every render. The trap reads the latest
  // one from here instead of starting over for it: each new start moved the
  // focus back to the opener and then to the first element, out of the field
  // the user was typing in whenever the page behind rendered again.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    // Store the element that had focus before modal opened
    previousActiveElement.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    const token = {};
    activeTraps.push(token);
    const isTopmost = () => activeTraps[activeTraps.length - 1] === token;

    // A click on text in the dialog (a heading, a paragraph) would otherwise
    // move the focus to <body>, out of reach of the keydown listener below:
    // focusable, the container takes it instead.
    const addedTabIndex = !container.hasAttribute('tabindex');
    if (addedTabIndex) container.setAttribute('tabindex', '-1');

    // Get all focusable elements
    const getFocusableElements = () => {
      return container.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)'
      );
    };

    // The element in the dialog that had the focus last.
    let lastFocused: HTMLElement | null = null;
    const handleFocusIn = (e: FocusEvent) => {
      lastFocused = e.target as HTMLElement;
    };
    container.addEventListener('focusin', handleFocusIn);

    // Focus first element
    const focusableElements = getFocusableElements();
    const firstElement = focusableElements[0];
    if (firstElement) {
      firstElement.focus();
    }

    // Handle Tab key to trap focus
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Escape
      if (e.key === 'Escape' && onEscapeRef.current) {
        if (isTopmost()) onEscapeRef.current();
        return;
      }

      // Handle Tab
      if (e.key === 'Tab') {
        const focusableElements = getFocusableElements();
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          // Shift+Tab; from the container itself too, which has the focus
          // after a click on text and sits before the first element.
          if (document.activeElement === firstElement || document.activeElement === container) {
            lastElement?.focus();
            e.preventDefault();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            firstElement?.focus();
            e.preventDefault();
          }
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    // Escape with the focus outside the dialog: after a click on the
    // backdrop the focus is on <body>. The listener above has answered every
    // Escape from inside; a widget outside that already used the key (a
    // portalled dropdown closing) marks it handled.
    const handleDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !onEscapeRef.current) return;
      if (e.target instanceof Node && container.contains(e.target)) return;
      if (!isTopmost()) return;
      onEscapeRef.current();
    };
    document.addEventListener('keydown', handleDocumentKeyDown);

    // A view change in the dialog (a list giving way to a form) can remove
    // the element that had the focus, which then drops to the page behind,
    // out of the trap. Bring it back to the first element - only then, so a
    // focus the user moved on purpose stays where it is.
    const observer = new MutationObserver(() => {
      const active = document.activeElement;
      if (lastFocused && !lastFocused.isConnected && (!active || active === document.body)) {
        getFocusableElements()[0]?.focus();
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    // Cleanup
    return () => {
      observer.disconnect();
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
      const index = activeTraps.indexOf(token);
      if (index !== -1) activeTraps.splice(index, 1);
      if (addedTabIndex) container.removeAttribute('tabindex');

      // Restore focus to previous element
      if (restoreFocus && previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isActive, restoreFocus]);

  return containerRef;
}
