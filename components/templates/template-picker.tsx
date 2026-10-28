'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Search, Star, FileText, Settings } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useTemplateStore } from '@/stores/template-store';
import { useAuthStore } from '@/stores/auth-store';
import { TemplateManagerModal } from './template-manager-modal';
import {
  getPlaceholdersFromTemplate,
  getAutoFilledPlaceholders,
} from '@/lib/template-utils';
import { PlaceholderFillModal } from './placeholder-fill-modal';
import type { EmailTemplate } from '@/lib/template-types';

interface TemplatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (template: EmailTemplate, filledValues: Record<string, string>) => void;
}

export function TemplatePicker({ isOpen, onClose, onSelect }: TemplatePickerProps) {
  const t = useTranslations('templates');
  const locale = useLocale();

  const { templates, getFavorites, getRecent, getTemplatesByCategory, searchTemplates, recordUsage } =
    useTemplateStore();
  const { primaryIdentity } = useAuthStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [showFillModal, setShowFillModal] = useState(false);
  // "Manage templates" (MAIL-31): the template manager in place of the
  // picker, which comes back when it closes.
  const [showManager, setShowManager] = useState(false);

  const favorites = getFavorites();
  const recent = getRecent();
  const byCategory = getTemplatesByCategory();
  const filtered = searchQuery ? searchTemplates(searchQuery) : null;

  const handleSelectTemplate = (template: EmailTemplate) => {
    const placeholders = getPlaceholdersFromTemplate(template);
    recordUsage(template.id);

    if (placeholders.length > 0) {
      setSelectedTemplate(template);
      setShowFillModal(true);
    } else {
      onSelect(template, {});
    }
  };

  const finishSelection = (values: Record<string, string>) => {
    if (selectedTemplate) {
      onSelect(selectedTemplate, values);
    }
    setShowFillModal(false);
    setSelectedTemplate(null);
  };

  if (!isOpen) return null;

  const autoFilled = getAutoFilledPlaceholders({
    senderName: primaryIdentity?.name,
    locale,
  });

  const renderTemplateItem = (template: EmailTemplate) => (
    <button
      key={template.id}
      type="button"
      onClick={() => handleSelectTemplate(template)}
      className="w-full text-start p-3 rounded-md hover:bg-muted transition-colors group"
    >
      <div className="flex items-center gap-2">
        {template.isFavorite && (
          <Star className="w-3 h-3 fill-amber-400 text-amber-400 flex-shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground truncate">
          {template.name}
        </span>
        {template.category && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex-shrink-0">
            {template.category}
          </span>
        )}
      </div>
      {template.subject && (
        <p className="text-xs text-muted-foreground truncate mt-1">
          {template.subject}
        </p>
      )}
    </button>
  );

  const renderSection = (key: string, title: string, items: EmailTemplate[]) => {
    if (items.length === 0) return null;
    return (
      <div key={key} className="mb-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-3">
          {title}
        </h3>
        <div className="space-y-0.5">{items.map(renderTemplateItem)}</div>
      </div>
    );
  };

  const categorizedEntries = Object.entries(byCategory).filter(
    ([cat]) => cat !== ''
  );
  const favoriteIds = new Set(favorites.map((f) => f.id));
  const recentFiltered = recent.filter((r) => !favoriteIds.has(r.id));
  const shownIds = new Set([
    ...favoriteIds,
    ...recentFiltered.map((r) => r.id),
  ]);
  const uncategorizedFiltered = (byCategory[''] || []).filter(
    (i) => !shownIds.has(i.id)
  );

  return (
    <>
      <Dialog
        isOpen={!showFillModal && !showManager}
        onClose={onClose}
        title={t('picker_title')}
        className="max-h-[70vh]"
        bodyClassName="px-0 pb-0 mt-3 border-t border-border"
        footer={
          <Button variant="outline" size="sm" className="me-auto mt-3 gap-2" onClick={() => setShowManager(true)}>
            <Settings className="w-4 h-4" />
            {t('manage')}
          </Button>
        }
      >

          <div className="px-4 py-2 border-b border-border">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search_placeholder')}
                className="ps-9 h-9"
                autoFocus
              />
            </div>
          </div>

          <div className="overflow-y-auto max-h-[calc(70vh-120px)] p-2">
            {templates.length === 0 && (
              <div className="flex flex-col items-center py-8 text-muted-foreground">
                <FileText className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">{t('no_templates')}</p>
              </div>
            )}

            {filtered ? (
              filtered.length > 0 ? (
                <div className="space-y-0.5">
                  {filtered.map(renderTemplateItem)}
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {t('no_results')}
                </div>
              )
            ) : (
              <>
                {renderSection('favorites', t('section_favorites'), favorites)}
                {renderSection('recent', t('section_recent'), recentFiltered)}
                {categorizedEntries.map(([cat, items]) =>
                  renderSection(
                    `category:${cat}`,
                    cat,
                    items.filter((i) => !shownIds.has(i.id))
                  )
                )}
                {renderSection('uncategorized', t('section_uncategorized'), uncategorizedFiltered)}
              </>
            )}
          </div>
      </Dialog>

      {showManager && <TemplateManagerModal isOpen onClose={() => setShowManager(false)} />}

      {showFillModal && selectedTemplate && (
        <PlaceholderFillModal
          template={selectedTemplate}
          placeholders={getPlaceholdersFromTemplate(selectedTemplate)}
          autoFilled={autoFilled}
          onConfirm={finishSelection}
          onSkip={() => finishSelection({})}
          onClose={() => {
            setShowFillModal(false);
            setSelectedTemplate(null);
          }}
        />
      )}
    </>
  );
}
