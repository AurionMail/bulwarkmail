'use client';

import { useCallback } from 'react';
import { toast } from '@/stores/toast-store';

export type AdminFeedback = { type: 'success' | 'error'; text: string } | null;

/**
 * Reports the outcome of an admin action in a toast, the same feedback the
 * rest of the app uses (R9). A success goes away by itself, an error stays
 * longer. `null` says nothing: it used to clear the page banner this
 * replaces, and pages still pass it before an action starts.
 */
export function useAdminFeedback(): (feedback: AdminFeedback) => void {
  return useCallback((feedback: AdminFeedback) => {
    if (!feedback) return;
    if (feedback.type === 'success') toast.success(feedback.text);
    else toast.error(feedback.text);
  }, []);
}
