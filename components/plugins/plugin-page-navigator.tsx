'use client';

// Moves the tab when a plugin asks for one of its own pages (api.ui.openPage,
// lib/plugin-sandbox/page-navigation.ts). Mounted once in the localized
// layout, so the request works from every view; the locale-aware router
// keeps the user's locale.

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { onPageNavigation } from '@/lib/plugin-sandbox/page-navigation';

export function PluginPageNavigator(): null {
  const router = useRouter();
  useEffect(() => onPageNavigation((href) => router.push(href as never)), [router]);
  return null;
}
