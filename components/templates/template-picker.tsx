'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { X, Search, Star, FileText } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useTemplateStore } from '@/stores/template-store';
import { useAuthStore } from '@/stores/auth-store';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useTemplateSources } from '@/hooks/use-template-sources';
import {
  filterTemplates,
  getPlaceholdersFromTemplate,
  getAutoFilledPlaceholders,
} from '@/lib/template-utils';
import type { TemplateSource } from '@/lib/templates/template-sources';
import { PlaceholderFillModal } from './placeholder-fill-modal';
import type { EmailTemplate } from '@/lib/template-types';

interface TemplatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (template: EmailTemplate, filledValues: Record<string, string>) => void;
  /**
   * The signed-in account the message is written from: its own templates,
   * its team templates and its organisation library. The active one when
   * left out.
   */
  accountId?: string | null;
}

export function TemplatePicker({ isOpen, onClose, onSelect, accountId }: TemplatePickerProps) {
  const t = useTranslations('templates');
  const tOrg = useTranslations('org_templates');
  const locale = useLocale();

  const recordUsage = useTemplateStore((s) => s.recordUsage);
  const recentTemplateIds = useTemplateStore((s) => s.recentTemplateIds);
  const { primaryIdentity } = useAuthStore();
  const { sources } = useTemplateSources(accountId);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [showFillModal, setShowFillModal] = useState(false);

  const modalRef = useFocusTrap({
    isActive: isOpen && !showFillModal,
    onEscape: onClose,
    restoreFocus: true,
  });

  const handleSelectTemplate = (template: EmailTemplate, source: TemplateSource) => {
    const placeholders = getPlaceholdersFromTemplate(template);
    // Recently used lists the user's own templates only.
    if (source.kind === 'personal') recordUsage(template.id);

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

  const renderTemplateItem = (template: EmailTemplate, source: TemplateSource) => (
    <button
      key={`${source.key}:${template.id}`}
      type="button"
      onClick={() => handleSelectTemplate(template, source)}
      className="w-full text-start p-3 rounded-md hover:bg-muted transition-colors group"
    >
      <div className="flex items-center gap-2 min-w-0">
        {source.kind === 'personal' && template.isFavorite && (
          <Star className="w-3 h-3 fill-amber-400 text-amber-400 flex-shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground truncate">
          {template.name}
        </span>
        {template.category && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex-shrink-0 max-w-[40%] truncate">
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

  const renderSection = (title: string, items: EmailTemplate[], source: TemplateSource) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-4" key={`${source.key}:${title}`}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-3">
          {title}
        </h3>
        <div className="space-y-0.5">{items.map((item) => renderTemplateItem(item, source))}</div>
      </div>
    );
  };

  const sourceTitle = (source: TemplateSource) =>
    source.kind === 'organisation' ? tOrg('section_organisation')
      : source.kind === 'team' ? (source.name ?? '')
        : tOrg('section_personal');

  // The user's own templates keep their favourites, recently used and
  // categories. With team or organisation templates next to them, the
  // whole block gets a heading of its own.
  const renderPersonal = (source: TemplateSource, withHeading: boolean) => {
    const templates = source.templates;
    const favorites = templates.filter((tpl) => tpl.isFavorite);
    const favoriteIds = new Set(favorites.map((f) => f.id));
    const recent = recentTemplateIds
      .map((id) => templates.find((tpl) => tpl.id === id))
      .filter((tpl): tpl is EmailTemplate => !!tpl && !favoriteIds.has(tpl.id));
    const shownIds = new Set([...favoriteIds, ...recent.map((r) => r.id)]);
    const byCategory: Record<string, EmailTemplate[]> = {};
    for (const tpl of templates) {
      if (shownIds.has(tpl.id)) continue;
      (byCategory[tpl.category || ''] ??= []).push(tpl);
    }
    const body = (
      <>
        {renderSection(t('section_favorites'), favorites, source)}
        {renderSection(t('section_recent'), recent, source)}
        {Object.entries(byCategory)
          .filter(([cat]) => cat !== '')
          .map(([cat, items]) => renderSection(cat, items, source))}
        {renderSection(t('section_uncategorized'), byCategory[''] ?? [], source)}
      </>
    );
    if (!withHeading) return <div key={source.key}>{body}</div>;
    if (templates.length === 0) return null;
    return (
      <section key={source.key} data-testid="template-source-personal" aria-label={sourceTitle(source)} className="mb-2">
        <h2 className="text-sm font-semibold text-foreground px-3 pt-1 pb-2">{sourceTitle(source)}</h2>
        {body}
      </section>
    );
  };

  const renderShared = (source: TemplateSource, items: EmailTemplate[]) => {
    if (items.length === 0) return null;
    return (
      <section key={source.key} data-testid={`template-source-${source.kind}`} aria-label={sourceTitle(source)} className="mb-2">
        <h2 className="text-sm font-semibold text-foreground px-3 pt-1 pb-2 truncate">{sourceTitle(source)}</h2>
        <div className="space-y-0.5 mb-4">{items.map((item) => renderTemplateItem(item, source))}</div>
      </section>
    );
  };

  const total = sources.reduce((n, source) => n + source.templates.length, 0);
  // Only the user's own templates: the picker looks as it always did.
  const onlyPersonal = sources.every((source) => source.kind === 'personal' || source.templates.length === 0);

  const results = searchQuery
    ? sources.map((source) => ({ source, items: filterTemplates(source.templates, searchQuery) }))
    : null;
  const resultCount = results?.reduce((n, r) => n + r.items.length, 0) ?? 0;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-picker-title"
          // The mail shortcuts behind the dialog must not see its keys.
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            'bg-background border border-border rounded-lg shadow-xl',
            'w-full max-w-md max-h-[70vh] overflow-hidden',
            'animate-in zoom-in-95 duration-200'
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 id="template-picker-title" className="text-sm font-semibold text-foreground">{t('picker_title')}</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4 py-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
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
            {total === 0 && (
              <div className="flex flex-col items-center py-8 text-muted-foreground">
                <FileText className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">{t('no_templates')}</p>
              </div>
            )}

            {results ? (
              resultCount > 0 ? (
                onlyPersonal ? (
                  <div className="space-y-0.5">
                    {results.flatMap(({ source, items }) => items.map((item) => renderTemplateItem(item, source)))}
                  </div>
                ) : (
                  results.map(({ source, items }) => renderShared(source, items))
                )
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {t('no_results')}
                </div>
              )
            ) : (
              sources.map((source) => source.kind === 'personal'
                ? renderPersonal(source, !onlyPersonal)
                : renderShared(source, source.templates))
            )}
          </div>
        </div>
      </div>

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
