// What a plugin may learn about the app itself: where a setting is (the same
// index the settings page searches, in the user's language) and the user's
// preferences. Used by the AI assistant to answer "how do I ...?" and "why
// does the app ...?" with the app's own names and the user's own values.

import enMessages from '@/locales/en/common.json';
import { LOCALE_LOADERS } from '@/components/providers/intl-provider';
import { mergeMessages } from '@/i18n/merge-messages';
import { detectBrowserLocale } from '@/i18n/detect-locale';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useThemeStore } from '@/stores/theme-store';
import { useAuthStore } from '@/stores/auth-store';
import { usePolicyStore } from '@/stores/policy-store';
import { fetchConfig } from '@/hooks/use-config';
import {
  collectSubResults, getByPath, tabKeywords, tabSearchPaths, type SettingsSearchTab, type SubResult,
} from '@/lib/settings-search';
import type { AppSettingsView, SettingsSearchResult } from '../plugin-types';

type Messages = Record<string, unknown>;

const MAX_QUERY = 200;
const MAX_RESULTS = 20;

async function messagesFor(locale: string): Promise<Messages> {
  const loader = LOCALE_LOADERS[locale];
  if (locale === 'en' || !loader) return enMessages as Messages;
  try {
    return mergeMessages(enMessages as never, (await loader()) as never) as Messages;
  } catch {
    return enMessages as Messages;
  }
}

/** The settings pages this user has: the server's support and the admin's gates, as on the settings page. */
async function availablePages(): Promise<Set<SettingsSearchTab>> {
  const client = useAuthStore.getState().client;
  const policy = usePolicyStore.getState();
  const gate = (feature: Parameters<typeof policy.isFeatureEnabled>[0]) => {
    try { return policy.isFeatureEnabled(feature); } catch { return true; }
  };
  let stalwart = true;
  try { stalwart = (await fetchConfig()).stalwartFeaturesEnabled ?? true; } catch { /* keep the default */ }
  const pages = new Set<SettingsSearchTab>(['account', 'notifications', 'general', 'appearance', 'message_list', 'reading', 'composing', 'organize', 'backup']);
  if (stalwart) pages.add('security');
  if (client?.supportsSieve?.()) pages.add('filters');
  if (client?.supportsVacationResponse?.()) pages.add('vacation');
  if (client?.supportsCalendars?.() && gate('calendarEnabled')) pages.add('calendar');
  if (gate('contactsEnabled')) pages.add('contacts');
  if (client?.supportsFiles?.() && gate('filesEnabled')) pages.add('files');
  if (gate('sidebarAppsEnabled') || gate('pluginsEnabled')) pages.add('addons');
  return pages;
}

function pageName(messages: Messages, tab: SettingsSearchTab): string {
  const name = getByPath(messages, `settings.tabs.${tab}`);
  return typeof name === 'string' ? name : tab;
}

/**
 * Settings matching a query, in the user's language: the page, the
 * setting's label and its description. The query may be in the user's
 * language or in English (a model often asks in English); every word counts.
 */
export async function doAppSearchSettings(query: unknown, options?: unknown): Promise<SettingsSearchResult[]> {
  if (typeof query !== 'string' || !query.trim()) throw new Error('app.searchSettings: query must be a non-empty string');
  const words = query.toLowerCase().slice(0, MAX_QUERY).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  if (!words.length) return [];
  const rawLimit = (options as { limit?: unknown } | undefined)?.limit;
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? Math.min(MAX_RESULTS, Math.max(1, Math.floor(rawLimit))) : 8;

  const locale = useLocaleStore.getState().locale || detectBrowserLocale('en');
  const local = await messagesFor(locale);
  const english = enMessages as Messages;
  const pages = await availablePages();

  const scored: { score: number; order: number; result: SettingsSearchResult }[] = [];
  let order = 0;
  for (const tab of Object.keys(tabSearchPaths) as SettingsSearchTab[]) {
    if (!pages.has(tab)) continue;
    const page = pageName(local, tab);
    const pageHaystack = `${page} ${pageName(english, tab)} ${tab.replace(/_/g, ' ')} ${tabKeywords[tab] ?? ''}`.toLowerCase();
    for (const path of tabSearchPaths[tab]) {
      // The merged catalogue has the English one's shape, so both walks line up.
      const mine: SubResult[] = [];
      const theirs: SubResult[] = [];
      collectSubResults(getByPath(local, path), mine);
      collectSubResults(getByPath(english, path), theirs);
      mine.forEach((entry, i) => {
        const en = theirs[i];
        const text = `${entry.label} ${entry.description ?? ''} ${en?.label ?? ''} ${en?.description ?? ''}`.toLowerCase();
        let score = 0;
        for (const word of words) {
          if (text.includes(word)) score += 2;
          else if (pageHaystack.includes(word)) score += 1;
        }
        if (score > 0) {
          scored.push({ score, order: order++, result: { pageId: tab, page, label: entry.label, ...(entry.description ? { description: entry.description } : {}) } });
        }
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const seen = new Set<string>();
  const out: SettingsSearchResult[] = [];
  for (const { result } of scored) {
    const key = `${result.pageId}|${result.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(result);
    if (out.length === limit) break;
  }
  return out;
}

/**
 * The user's preferences that say how the app behaves for them: layout,
 * theme, language and formats, reading and sending behaviour, notifications.
 * Plain values only; nothing about other people (trusted senders, mutes)
 * and nothing that addresses a server (the push relay).
 */
export const SHARED_SETTINGS = [
  'fontSize', 'density', 'interfaceLayout', 'mailLayout', 'toolbarPosition', 'showToolbarLabels', 'animationsEnabled', 'proInterface',
  'dateFormat', 'timeFormat', 'firstDayOfWeek', 'timeZone',
  'disableThreading', 'showPreview', 'listColumns', 'emailsPerPage', 'showVerificationCodes',
  'markAsReadDelay', 'externalContentPolicy', 'attachmentPosition', 'mailAttachmentAction', 'emailAlwaysLightMode', 'returnToListAfterAction', 'plainTextFont',
  'deleteAction', 'archiveMode', 'permanentlyDeleteJunk', 'confirmBulkDelete',
  'sendDelaySeconds', 'sendConfirmation', 'defaultReplyMode', 'plainTextMode', 'signaturePosition', 'signatureSeparatorEnabled',
  'requestReadReceiptDefault', 'readReceiptResponse', 'autoSaveDraftInterval', 'autoSelectReplyIdentity',
  'showWeekNumbers', 'calendarWorkingDays', 'enableCalendarTasks', 'showBirthdayCalendar',
  'emailNotificationsEnabled', 'emailNotificationSound', 'calendarNotificationsEnabled',
  'enableUnifiedMailbox', 'sessionTimeout',
] as const;

export function doAppGetSettings(): AppSettingsView {
  const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
  const out: AppSettingsView = {};
  for (const key of SHARED_SETTINGS) {
    const value = state[key];
    if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === 'number' || typeof v === 'string')) out[key] = value.slice(0, 20) as number[] | string[];
  }
  const theme = (useThemeStore.getState() as unknown as { theme?: unknown }).theme;
  if (typeof theme === 'string') out.theme = theme;
  const locale = useLocaleStore.getState().locale;
  if (locale) out.language = locale;
  return out;
}
