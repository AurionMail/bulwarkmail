"use client";

import { useSyncExternalStore } from 'react';
import { allPages, subscribePages, type RegisteredPage } from '@/lib/plugin-sandbox/pages';

/** Pages plugins registered with api.ui.setPages, in install order. */
export function usePluginPages(): RegisteredPage[] {
  return useSyncExternalStore(subscribePages, allPages, allPages);
}

/** The in-app route of a plugin page: /apps/<pluginId>/<pageId>. */
export function pluginPageHref(page: Pick<RegisteredPage, 'pluginId' | 'id'>): string {
  return `/apps/${encodeURIComponent(page.pluginId)}/${encodeURIComponent(page.id)}`;
}

/** Whether `pathname` (locale already stripped) shows this page. */
export function isPluginPageActive(pathname: string, page: Pick<RegisteredPage, 'pluginId' | 'id'>): boolean {
  const href = pluginPageHref(page);
  return pathname === href || pathname.startsWith(`${href}/`);
}
