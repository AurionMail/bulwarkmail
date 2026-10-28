/**
 * A signed-in account's own templates, wherever they live: in the account
 * (account-templates-store, kept in the Inbox metadata on Stalwart v1.0.0
 * and later), or, for accounts without, the browser's list in
 * template-store as before. Everything that changes personal templates
 * (the template manager, the composer's "Save as template", plugins) goes
 * through here, so an account's templates stay that account's.
 */

import type { EmailTemplate } from '@/lib/template-types';
import { exportTemplates, filterTemplates, importTemplates as parseImport } from '@/lib/template-utils';
import { templateHooks } from '@/lib/plugin-hooks';
import { templateToView } from '@/lib/plugin-projection';
import { generateUUID } from '@/lib/utils';
import { onFullSignOut } from '@/lib/sign-out-cleanup';
import { useAuthStore } from '@/stores/auth-store';
import { useTemplateStore } from '@/stores/template-store';
import { readSettingsOwner } from '@/stores/settings-store';
import {
  notifyPersonalChange,
  onPersonalChange,
  useAccountTemplatesStore,
  type LocalOnlyReason,
  type PersonalPartition,
} from '@/stores/account-templates-store';
import { syncPersonalTemplates, type MetadataClient, type SyncOutcome } from './account-template-sync';

type TemplateData = Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>;
type TemplateUpdate = Partial<Omit<EmailTemplate, 'id' | 'createdAt'>>;

export interface PersonalTemplateOps {
  /** The account keeps its templates (in the server's metadata), not just this browser. */
  storedInAccount: boolean;
  templates: () => EmailTemplate[];
  localOnly: () => Record<string, LocalOnlyReason>;
  add: (data: TemplateData) => EmailTemplate;
  update: (id: string, updates: TemplateUpdate) => void;
  remove: (id: string) => void;
  duplicate: (id: string, nameSuffix?: string) => EmailTemplate | null;
  toggleFavorite: (id: string) => void;
  search: (query: string) => EmailTemplate[];
  exportAll: () => string;
  importJson: (json: string) => { count: number; errors: string[] };
}

/** The account a call is about: the given one, or the active one. */
export function resolveAccountId(accountId?: string | null): string | null {
  return accountId || useAuthStore.getState().activeAccountId || null;
}

/** Whether the account's templates live in the account. */
export function isStoredInAccount(accountId?: string | null): boolean {
  const id = resolveAccountId(accountId);
  return !!id && !!useAccountTemplatesStore.getState().personal[id];
}

function legacyOps(): PersonalTemplateOps {
  const store = () => useTemplateStore.getState();
  return {
    storedInAccount: false,
    templates: () => store().templates,
    localOnly: () => ({}),
    add: (data) => store().addTemplate(data),
    update: (id, updates) => store().updateTemplate(id, updates),
    remove: (id) => store().deleteTemplate(id),
    duplicate: (id, suffix) => store().duplicateTemplate(id, suffix),
    toggleFavorite: (id) => store().toggleFavorite(id),
    search: (query) => store().searchTemplates(query),
    exportAll: () => store().exportAllTemplates(),
    importJson: (json) => store().importTemplates(json),
  };
}

function accountOps(accountId: string): PersonalTemplateOps {
  const partition = (): PersonalPartition | undefined => useAccountTemplatesStore.getState().personal[accountId];
  const templates = () => partition()?.templates ?? [];
  const change = (fn: (p: PersonalPartition) => PersonalPartition) => {
    useAccountTemplatesStore.getState().updatePersonal(accountId, fn);
    notifyPersonalChange(accountId);
  };
  const find = (id: string) => templates().find((t) => t.id === id);
  const emitUpdate = (id: string) => {
    const template = find(id);
    if (template) void templateHooks.onTemplateUpdate.emit(templateToView(template));
  };
  const add = (data: TemplateData): EmailTemplate => {
    const now = new Date().toISOString();
    const template: EmailTemplate = { ...data, id: generateUUID(), createdAt: now, updatedAt: now };
    change((p) => ({ ...p, templates: [...p.templates, template] }));
    void templateHooks.onTemplateCreate.emit(templateToView(template));
    return template;
  };
  return {
    storedInAccount: true,
    templates,
    localOnly: () => partition()?.localOnly ?? {},
    add,
    update: (id, updates) => {
      if (!find(id)) return;
      const now = new Date().toISOString();
      change((p) => ({ ...p, templates: p.templates.map((t) => (t.id === id ? { ...t, ...updates, updatedAt: now } : t)) }));
      emitUpdate(id);
    },
    remove: (id) => {
      if (!find(id)) return;
      const now = new Date().toISOString();
      change((p) => {
        const localOnly = { ...p.localOnly };
        delete localOnly[id];
        return { ...p, templates: p.templates.filter((t) => t.id !== id), deletedTemplateIds: { ...p.deletedTemplateIds, [id]: now }, localOnly };
      });
      void templateHooks.onTemplateDelete.emit({ templateId: id });
    },
    duplicate: (id, suffix) => {
      const original = find(id);
      if (!original) return null;
      return add({ ...original, name: `${original.name} ${suffix || '(copy)'}`, isFavorite: false });
    },
    toggleFavorite: (id) => {
      const template = find(id);
      if (!template) return;
      const now = new Date().toISOString();
      change((p) => ({ ...p, templates: p.templates.map((t) => (t.id === id ? { ...t, isFavorite: !t.isFavorite, updatedAt: now } : t)) }));
      emitUpdate(id);
    },
    search: (query) => filterTemplates(templates(), query),
    exportAll: () => exportTemplates(templates()),
    importJson: (json) => {
      const result = parseImport(json);
      if (result.templates.length > 0) {
        change((p) => ({ ...p, templates: [...p.templates, ...result.templates] }));
        void templateHooks.onTemplatesImport.emit({ count: result.templates.length });
      }
      return { count: result.templates.length, errors: result.errors };
    },
  };
}

/** The personal templates of the signed-in account `accountId` (the active one when left out). */
export function personalTemplatesFor(accountId?: string | null): PersonalTemplateOps {
  const id = resolveAccountId(accountId);
  return id && useAccountTemplatesStore.getState().personal[id] ? accountOps(id) : legacyOps();
}

// ─── Syncing ──────────────────────────────────────────────────

function clientFor(accountId: string): MetadataClient | null {
  const auth = useAuthStore.getState();
  const client = auth.getClientForAccount?.(accountId) ?? (accountId === auth.activeAccountId ? auth.client : null);
  return (client as unknown as MetadataClient | null) ?? null;
}

/** Sync the account's personal templates now. */
export function syncAccountTemplates(accountId: string): Promise<SyncOutcome> {
  const client = clientFor(accountId);
  if (!client || typeof client.getAccountId !== 'function') return Promise.resolve('unsupported');
  return syncPersonalTemplates(accountId, client, () => browserListOf(accountId));
}

/**
 * The browser's template list, if it is this account's: the active
 * account's once its synced settings are loaded, or a list no account's
 * settings sync owns (sync off, Lite). Never another account's, which
 * would copy one account's templates into another's mailbox.
 */
function browserListOf(accountId: string): EmailTemplate[] | null {
  if (accountId !== useAuthStore.getState().activeAccountId) return null;
  const owner = readSettingsOwner();
  if (owner !== null && owner !== accountId) return null;
  return useTemplateStore.getState().templates;
}

// The browser's list changing for an account that doesn't keep its own
// copy yet (its synced settings just loaded) is the moment to set it up.
useTemplateStore.subscribe(() => {
  const active = useAuthStore.getState().activeAccountId;
  if (active && !useAccountTemplatesStore.getState().personal[active]) scheduleAccountSync(active);
});

const SYNC_DELAY_MS = 800;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Sync shortly after a change, once for a burst of changes. */
export function scheduleAccountSync(accountId: string): void {
  const pending = timers.get(accountId);
  if (pending) clearTimeout(pending);
  timers.set(accountId, setTimeout(() => {
    timers.delete(accountId);
    void syncAccountTemplates(accountId);
  }, SYNC_DELAY_MS));
}

onPersonalChange(scheduleAccountSync);

const lastSync = new Map<string, number>();

/** Sync when the last round is older than `maxAgeMs` (opening the picker or the manager, coming back to the tab). */
export function refreshAccountTemplates(accountId: string | null | undefined, maxAgeMs = 15_000): void {
  const id = resolveAccountId(accountId);
  if (!id) return;
  const last = lastSync.get(id) ?? 0;
  if (Date.now() - last < maxAgeMs) return;
  lastSync.set(id, Date.now());
  void syncAccountTemplates(id);
}

// At a full sign-out only what exists nowhere else stays in this browser.
onFullSignOut(() => {
  lastSync.clear();
  useAccountTemplatesStore.getState().forgetServerCopies();
});
