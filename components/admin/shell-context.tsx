'use client';

import { createContext, useContext } from 'react';

export interface AdminShellContextValue {
  /** Where a page's save bar renders: below the scrolling content, above the mobile rail. */
  saveBarHost: HTMLElement | null;
  /** Re-reads the counts shown next to sidebar entries (pending approvals). */
  refreshBadges: () => void;
}

export const AdminShellContext = createContext<AdminShellContextValue | null>(null);

export function useAdminShell(): AdminShellContextValue | null {
  return useContext(AdminShellContext);
}
