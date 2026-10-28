'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, Pencil, Trash2, Star, CopyPlus, Search } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useDiscardChanges } from '@/components/settings/use-discard-changes';
import { TemplateForm } from './template-form';
import { useTemplateStore } from '@/stores/template-store';
import type { EmailTemplate } from '@/lib/template-types';

interface TemplateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TemplateManagerModal({ isOpen, onClose }: TemplateManagerModalProps) {
  const t = useTranslations('templates');
  const tSettings = useTranslations('settings.templates');
  const tCommon = useTranslations('common');

  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    toggleFavorite,
    searchTemplates,
  } = useTemplateStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { confirmDiscard, discardDialog } = useDiscardChanges();
  const { dialogProps: deleteDialogProps, confirm: confirmDelete } = useConfirmDialog();

  const filtered = searchQuery ? searchTemplates(searchQuery) : templates;
  const formOpen = isCreating || !!editingId;

  const closeForm = () => {
    setIsCreating(false);
    setEditingId(null);
    setFormDirty(false);
  };

  // Escape, the X and Cancel ask first while the form holds changes (R5).
  const requestClose = async () => {
    if (!(await confirmDiscard(formDirty))) return;
    closeForm();
    onClose();
  };
  const requestCloseForm = async () => {
    if (!(await confirmDiscard(formDirty))) return;
    closeForm();
  };

  const handleSave = (data: Omit<EmailTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (editingId) {
      updateTemplate(editingId, data);
    } else {
      addTemplate(data);
    }
    closeForm();
  };

  const handleDelete = async (template: EmailTemplate) => {
    const ok = await confirmDelete({
      title: t('delete_title'),
      message: t('delete_message', { name: template.name }),
      confirmText: tCommon('delete'),
      cancelText: tCommon('cancel'),
      variant: 'destructive',
    });
    if (ok) deleteTemplate(template.id);
  };

  return (
    <>
      <Dialog
        isOpen={isOpen}
        onClose={() => void requestClose()}
        title={tSettings('title')}
        size="lg"
        dirty={formDirty}
        testId="template-manager"
      >
        {!formOpen && (
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search_placeholder')}
                aria-label={t('search_placeholder')}
                className="ps-9"
              />
            </div>
            <Button onClick={() => setIsCreating(true)} size="sm">
              {tSettings('add')}
            </Button>
          </div>
        )}

        {isCreating && (
          <div className="mb-6 p-4 border border-border rounded-lg bg-muted/30">
            <h3 className="text-sm font-semibold mb-4">{tSettings('add')}</h3>
            <TemplateForm
              onSave={handleSave}
              onCancel={() => void requestCloseForm()}
              onDirtyChange={setFormDirty}
            />
          </div>
        )}

        {editingId && (
          <div className="mb-6 p-4 border border-border rounded-lg bg-muted/30">
            <h3 className="text-sm font-semibold mb-4">{tSettings('edit')}</h3>
            <TemplateForm
              template={templates.find((tpl) => tpl.id === editingId)}
              onSave={handleSave}
              onCancel={() => void requestCloseForm()}
              onDirtyChange={setFormDirty}
            />
          </div>
        )}

        <div className="space-y-2">
          {filtered.map((template) => (
            <div
              key={template.id}
              className="flex items-center gap-3 p-3 rounded-md border border-border hover:bg-muted/50 transition-colors"
            >
              <IconButton
                label={tSettings('favorite')}
                aria-pressed={!!template.isFavorite}
                onClick={() => toggleFavorite(template.id)}
                className="flex-shrink-0 -ms-1.5"
              >
                <Star
                  className={cn(
                    'w-4 h-4 transition-colors',
                    template.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
                  )}
                />
              </IconButton>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate" dir="auto" title={template.name}>
                    {template.name}
                  </p>
                  {template.category && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex-shrink-0">
                      {template.category}
                    </span>
                  )}
                </div>
                {template.subject && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5" dir="auto" title={template.subject}>
                    {template.subject}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <IconButton
                  label={tSettings('edit')}
                  onClick={() => { setEditingId(template.id); setIsCreating(false); }}
                  disabled={formOpen}
                >
                  <Pencil />
                </IconButton>
                <IconButton
                  label={t('duplicate')}
                  onClick={() => duplicateTemplate(template.id, t('copy_suffix'))}
                  disabled={formOpen}
                >
                  <CopyPlus />
                </IconButton>
                <IconButton
                  label={tCommon('delete')}
                  onClick={() => void handleDelete(template)}
                  disabled={formOpen}
                >
                  <Trash2 />
                </IconButton>
              </div>
            </div>
          ))}

          {filtered.length === 0 && !isCreating && (
            <EmptyState
              icon={FileText}
              title={searchQuery ? t('no_results') : tSettings('no_templates')}
              actions={searchQuery ? undefined : (
                <Button size="sm" onClick={() => setIsCreating(true)}>{tSettings('add')}</Button>
              )}
            />
          )}
        </div>
      </Dialog>
      {discardDialog}
      <ConfirmDialog {...deleteDialogProps} />
    </>
  );
}
