'use client';

import { sanitizeEmailHtml } from '@/lib/email-sanitization';
import type { EmailTemplate } from '@/lib/template-types';

/** A template's body as it goes into the composer, for templates the user can't open in the editor. */
export function TemplateBodyPreview({ template }: { template: Pick<EmailTemplate, 'body' | 'isHTML'> }) {
  if (template.isHTML) {
    return (
      <div
        className="max-h-60 overflow-auto text-sm break-words text-foreground"
        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(template.body || '') }}
      />
    );
  }
  return <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-foreground">{template.body}</pre>;
}
