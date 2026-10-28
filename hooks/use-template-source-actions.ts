import { useMemo } from 'react';
import type { EmailTemplate } from '@/lib/template-types';
import type { TemplateSource } from '@/lib/templates/template-sources';
import { useTemplateStore } from '@/stores/template-store';

/** What a change to a template came to; anything but 'ok' keeps the form open. */
export type TemplateSaveResult = 'ok' | 'too-large' | 'no-room' | 'forbidden' | 'failed';

/** Why a personal template could not go to the server and stays in this browser. */
export type LocalOnlyReason = 'too-large' | 'no-room';

type TemplateData = Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>;

export interface TemplateSourceActions {
  add: (source: TemplateSource, data: TemplateData) => Promise<TemplateSaveResult>;
  update: (source: TemplateSource, id: string, data: TemplateData) => Promise<TemplateSaveResult>;
  remove: (source: TemplateSource, id: string) => Promise<TemplateSaveResult>;
  duplicate: (source: TemplateSource, id: string, nameSuffix: string) => Promise<TemplateSaveResult>;
  toggleFavorite: (source: TemplateSource, id: string) => Promise<TemplateSaveResult>;
  /** A read-only (organisation or team) template copied into the user's own. */
  copyToPersonal: (template: EmailTemplate) => Promise<TemplateSaveResult>;
  /** Personal templates that stay in this browser, by id. */
  localOnly: Record<string, LocalOnlyReason>;
  /** Personal templates live in the account (server metadata), not only in this browser. */
  storedInAccount: boolean;
}

const readOnly = async (): Promise<TemplateSaveResult> => 'forbidden';

/**
 * Changes to the templates of each source the manager shows, for the
 * signed-in account `accountId`. Read-only sources refuse every change.
 */
export function useTemplateSourceActions(accountId?: string | null): TemplateSourceActions {
  void accountId;
  return useMemo(() => {
    const store = () => useTemplateStore.getState();
    const personalOnly = <A extends unknown[]>(fn: (...args: A) => void) =>
      async (source: TemplateSource, ...args: A): Promise<TemplateSaveResult> => {
        if (source.kind !== 'personal' || !source.editable) return readOnly();
        fn(...args);
        return 'ok';
      };
    return {
      add: personalOnly((data: TemplateData) => { store().addTemplate(data); }),
      update: personalOnly((id: string, data: TemplateData) => store().updateTemplate(id, data)),
      remove: personalOnly((id: string) => store().deleteTemplate(id)),
      duplicate: personalOnly((id: string, suffix: string) => { store().duplicateTemplate(id, suffix); }),
      toggleFavorite: personalOnly((id: string) => store().toggleFavorite(id)),
      copyToPersonal: async (template) => {
        store().addTemplate(copyOf(template));
        return 'ok';
      },
      localOnly: {},
      storedInAccount: false,
    };
  }, []);
}

/** The fields a copy of a shared template takes into the user's own list. */
export function copyOf(template: EmailTemplate): TemplateData {
  return {
    name: template.name,
    subject: template.subject,
    body: template.body,
    isHTML: template.isHTML,
    category: template.category,
    defaultRecipients: template.defaultRecipients,
    isFavorite: false,
  };
}
