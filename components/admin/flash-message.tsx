'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { CheckCircle2, AlertTriangle, X } from '@/components/icons';
import { cn } from '@/lib/utils';

export type FlashMessage = { type: 'success' | 'error'; text: string } | null;

/** Page-level feedback state; the message is shown with `<Flash>`. */
export function useFlash(): [FlashMessage, Dispatch<SetStateAction<FlashMessage>>] {
  return useState<FlashMessage>(null);
}

interface FlashProps {
  message: FlashMessage;
  onDismiss: () => void;
  className?: string;
}

/**
 * The outcome of the last action, under the page header. A success goes
 * away by itself; an error stays until dismissed or the next action.
 */
export function Flash({ message, onDismiss, className }: FlashProps) {
  useEffect(() => {
    if (message?.type !== 'success') return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;
  const success = message.type === 'success';
  const Icon = success ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role={success ? 'status' : 'alert'}
      className={cn(
        'mb-6 flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm',
        success
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1 min-w-0 break-words">{message.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 -me-1 rounded p-0.5 opacity-70 hover:opacity-100 transition-opacity"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
