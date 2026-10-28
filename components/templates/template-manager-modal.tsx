'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X, FileText, Pencil, Trash2, Star, Copy, Search, Eye } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TemplateForm } from './template-form';
import { TemplateBodyPreview } from './template-body-preview';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useTemplateSources } from '@/hooks/use-template-sources';
import { useTemplateSourceActions, type TemplateSaveResult } from '@/hooks/use-template-source-actions';
import { OrgLockedNote } from '@/components/settings/org-locked-note';
import { filterTemplates } from '@/lib/template-utils';
import { PERSONAL_SOURCE, type TemplateSource } from '@/lib/templates/template-sources';
import { refreshAccountTemplates, resolveAccountId } from '@/lib/templates/personal-templates';
import { refreshTeamTemplates } from '@/lib/templates/team-templates';
import type { EmailTemplate } from '@/lib/template-types';

interface TemplateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The signed-in account whose templates are managed; the active one when left out. */
  accountId?: string | null;
}

type TemplateData = Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>;

export function TemplateManagerModal({ isOpen, onClose, accountId }: TemplateManagerModalProps) {
  const t = useTranslations('templates');
  const tSettings = useTranslations('settings.templates');
  const tOrg = useTranslations('org_templates');

  const { sources, personalHidden } = useTemplateSources(accountId);
  const actions = useTemplateSourceActions(accountId);

  const [selectedKey, setSelectedKey] = useState<string>(PERSONAL_SOURCE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const source: TemplateSource | undefined = sources.find((s) => s.key === selectedKey) ?? sources[0];
  const personal = sources.find((s) => s.kind === 'personal');

  const closeForm = () => {
    setIsCreating(false);
    setEditingId(null);
    setError(null);
  };

  useEffect(() => {
    if (!isOpen) return;
    refreshAccountTemplates(accountId);
    const id = resolveAccountId(accountId);
    if (id) refreshTeamTemplates(id);
  }, [isOpen, accountId]);

  const modalRef = useFocusTrap({
    isActive: isOpen,
    onEscape: () => {
      if (isCreating || editingId) closeForm();
      else onClose();
    },
    restoreFocus: true,
  });

  const selectSource = (key: string) => {
    setSelectedKey(key);
    closeForm();
    setDeleteConfirmId(null);
    setPreviewId(null);
  };

  const sourceTitle = (s: TemplateSource) =>
    s.kind === 'organisation' ? tOrg('section_organisation')
      : s.kind === 'team' ? (s.name ?? '')
        : tOrg('section_personal');

  const errorText = (result: TemplateSaveResult) =>
    result === 'too-large' ? tOrg('save_failed_too_large')
      : result === 'no-room' ? tOrg('save_failed_no_room')
        : result === 'forbidden' ? tOrg('save_failed_forbidden')
          : tOrg('save_failed');

  // A failed save keeps the form open with what the user typed.
  const run = async (step: () => Promise<TemplateSaveResult>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const result = await step();
      if (result === 'ok') after();
      else setError(errorText(result));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = (data: TemplateData) => {
    if (!source?.editable) return;
    if (editingId) void run(() => actions.update(source, editingId, data), closeForm);
    else void run(() => actions.add(source, data), closeForm);
  };

  const handleDelete = (id: string) => {
    if (!source?.editable) return;
    void run(() => actions.remove(source, id), () => setDeleteConfirmId(null));
  };

  if (!isOpen) return null;

  const templates = source?.templates ?? [];
  const filtered = searchQuery ? filterTemplates(templates, searchQuery) : templates;
  const editable = !!source?.editable;
  const isPersonal = source?.kind === 'personal';
  const showTabs = sources.length > 1 || personalHidden;

  let note: React.ReactNode = null;
  if (source?.kind === 'organisation') {
    note = <p className="text-xs text-muted-foreground">{tOrg('organisation_note')}</p>;
  } else if (source?.kind === 'team') {
    note = source.locked
      ? <OrgLockedNote />
      : <p className="text-xs text-muted-foreground">{source.editable ? tOrg('team_note', { name: source.name ?? '' }) : tOrg('team_read_only')}</p>;
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[1px] flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-manager-title"
        // The mail shortcuts behind the dialog must not see its keys.
        onKeyDown={(e) => e.stopPropagation()}
        className={cn(
          'bg-background border border-border rounded-lg shadow-xl',
          'w-full max-w-3xl max-h-[90vh] overflow-hidden',
          'animate-in zoom-in-95 duration-200'
        )}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <h2 id="template-manager-title" className="text-lg font-semibold text-foreground truncate">
              {tSettings('title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted transition-colors duration-150 text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
          {showTabs && (
            <div role="tablist" aria-label={tOrg('sources_label')} className="flex flex-wrap gap-2 mb-3" data-testid="template-sources">
              {sources.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={s.key === source?.key}
                  data-testid={`template-source-tab-${s.kind}`}
                  onClick={() => selectSource(s.key)}
                  className={cn(
                    'max-w-full truncate rounded-full border px-3 py-1 text-sm transition-colors',
                    s.key === source?.key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  {sourceTitle(s)} <span className="text-xs opacity-70">{s.templates.length}</span>
                </button>
              ))}
            </div>
          )}

          {note && <div className="mb-4" data-testid="template-source-note">{note}</div>}

          {!source && (
            <div className="flex flex-col items-center py-8 text-muted-foreground">
              <FileText className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">{tSettings('no_templates')}</p>
            </div>
          )}

          {source && !isCreating && !editingId && (
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('search_placeholder')}
                  className="ps-9"
                />
              </div>
              {editable && (
                <Button onClick={() => { setIsCreating(true); setError(null); }} size="sm">
                  {tSettings('add')}
                </Button>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400" data-testid="template-save-error">{error}</p>
          )}

          {editable && isCreating && (
            <div className="mb-6 p-4 border border-border rounded-lg bg-muted/30">
              <h3 className="text-sm font-semibold mb-4">{tSettings('add')}</h3>
              <TemplateForm
                shared={!isPersonal}
                busy={busy}
                onSave={handleSave}
                onCancel={closeForm}
              />
            </div>
          )}

          {editable && editingId && (
            <div className="mb-6 p-4 border border-border rounded-lg bg-muted/30">
              <h3 className="text-sm font-semibold mb-4">{tSettings('edit')}</h3>
              <TemplateForm
                template={templates.find((tpl) => tpl.id === editingId)}
                shared={!isPersonal}
                busy={busy}
                onSave={handleSave}
                onCancel={closeForm}
              />
            </div>
          )}

          <div className="space-y-2">
            {source && filtered.map((template) => (
              <div key={template.id} className="rounded-md border border-border hover:bg-muted/50 transition-colors" data-testid="template-row">
                <div className="flex items-center gap-2 sm:gap-3 p-3">
                  {isPersonal && (
                    <button
                      type="button"
                      onClick={() => void actions.toggleFavorite(source, template.id)}
                      aria-label={tSettings('favorite')}
                      aria-pressed={template.isFavorite}
                      className="flex-shrink-0"
                    >
                      <Star
                        className={cn(
                          'w-4 h-4 transition-colors',
                          template.isFavorite
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-muted-foreground hover:text-amber-400'
                        )}
                      />
                    </button>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {template.name}
                      </p>
                      {template.category && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex-shrink-0 max-w-[40%] truncate">
                          {template.category}
                        </span>
                      )}
                    </div>
                    {template.subject && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {template.subject}
                      </p>
                    )}
                    {isPersonal && actions.localOnly[template.id] && (
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1" data-testid="template-local-only">
                        {actions.localOnly[template.id] === 'too-large' ? tOrg('local_only_too_large') : tOrg('local_only_no_room')}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {editable ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setEditingId(template.id); setIsCreating(false); setError(null); }}
                          disabled={!!editingId || isCreating}
                          aria-label={tSettings('edit')}
                          className="h-8 w-8 p-0"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void run(() => actions.duplicate(source, template.id, t('copy_suffix')), () => {})}
                          disabled={!!editingId || isCreating || busy}
                          aria-label={tOrg('duplicate')}
                          className="h-8 w-8 p-0"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        {deleteConfirmId === template.id ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDelete(template.id)}
                              disabled={busy}
                              className="h-7 text-xs"
                            >
                              {tSettings('confirm_delete')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirmId(null)}
                              className="h-7 text-xs"
                            >
                              {tSettings('cancel')}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirmId(template.id)}
                            disabled={!!editingId || isCreating}
                            aria-label={tSettings('confirm_delete')}
                            className="h-8 w-8 p-0 hover:text-red-600 dark:hover:text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreviewId(previewId === template.id ? null : template.id)}
                          aria-label={t('preview')}
                          aria-expanded={previewId === template.id}
                          className="h-8 w-8 p-0"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {personal?.editable && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void run(() => actions.copyToPersonal(template), () => {})}
                            disabled={busy}
                            aria-label={tOrg('copy_to_personal')}
                            title={tOrg('copy_to_personal')}
                            className="h-8 w-8 p-0"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {previewId === template.id && (
                  <div className="border-t border-border px-3 py-2" data-testid="template-preview">
                    <TemplateBodyPreview template={template} />
                  </div>
                )}
              </div>
            ))}

            {source && filtered.length === 0 && !isCreating && (
              <div className="flex flex-col items-center py-8 text-muted-foreground">
                <FileText className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm">
                  {searchQuery ? t('no_results') : tSettings('no_templates')}
                </p>
              </div>
            )}
          </div>

          {isPersonal && actions.storedInAccount && (
            <p className="mt-4 text-xs text-muted-foreground" data-testid="template-storage-note">{tOrg('personal_in_account')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
