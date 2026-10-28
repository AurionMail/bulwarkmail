"use client";

import { useCallback, useMemo, useRef, useState } from "react";

const LONG_PRESS_DURATION = 500;
const MOVE_THRESHOLD = 10;

export function useLongPress(
  onLongPress: (position: { clientX: number; clientY: number }) => void,
  enabled: boolean = true
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const [isPressed, setIsPressed] = useState(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
    setIsPressed(false);
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!enabled) return;
      const touch = e.touches[0];
      startPosRef.current = { x: touch.clientX, y: touch.clientY };
      firedRef.current = false;
      setIsPressed(true);

      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        setIsPressed(false);
        onLongPress({ clientX: touch.clientX, clientY: touch.clientY });
      }, LONG_PRESS_DURATION);
    },
    [enabled, onLongPress]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startPosRef.current || !timerRef.current) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - startPosRef.current.x);
      const dy = Math.abs(touch.clientY - startPosRef.current.y);
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
        cancel();
      }
    },
    [cancel]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (firedRef.current) {
        e.preventDefault();
      }
      cancel();
      firedRef.current = false;
    },
    [cancel]
  );

  const onTouchCancel = useCallback(() => {
    cancel();
    firedRef.current = false;
  }, [cancel]);

  // `handlers` holds only the touch handlers, safe to spread onto a DOM
  // element; spreading the whole result would put `isPressed` on it.
  const handlers = useMemo(
    () => ({ onTouchStart, onTouchEnd, onTouchMove, onTouchCancel }),
    [onTouchStart, onTouchEnd, onTouchMove, onTouchCancel]
  );

  return { onTouchStart, onTouchEnd, onTouchMove, onTouchCancel, isPressed, handlers };
}
