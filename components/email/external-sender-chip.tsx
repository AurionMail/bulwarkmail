'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building } from '@/components/icons';
import { cn } from '@/lib/utils';
import { externalSenders, internalDomains, type ExternalSender } from '@/lib/external-mail';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';

type FromList = readonly { email?: string | null }[] | null | undefined;

/**
 * The From addresses outside the organisation when the admin turned the
 * "External" label on (lib/external-mail.ts); empty otherwise.
 */
export function useExternalSenders(from: FromList): ExternalSender[] {
  const externalMail = usePolicyStore((s) => s.policy.organisation?.externalMail);
  const identities = useAuthStore((s) => s.identities);
  return useMemo(() => {
    if (!externalMail?.senderLabel) return [];
    const internal = internalDomains((identities ?? []).map((identity) => identity.email), externalMail.domains);
    return externalSenders(from, internal);
  }, [externalMail, identities, from]);
}

/**
 * "External" next to the sender's name. A chip and not a banner, so it sits
 * beside the unverified-sender warning without adding a second banner, and
 * it keeps to one short word so the narrow phone header doesn't wrap more.
 *
 * It is a button: a tap (phones have no hover) or Enter opens a line naming
 * the domain. Inside another button (a conversation card's header) it can't
 * be one, so `interactive={false}` keeps it a label with a tooltip.
 */
export function ExternalSenderChip({ from, className, interactive = true }: { from: FromList; className?: string; interactive?: boolean }) {
  const t = useTranslations('external_mail');
  const senders = useExternalSenders(from);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('focusin', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('focusin', close);
    };
  }, [open]);

  if (senders.length === 0) return null;
  const domains = [...new Set(senders.map((s) => s.domain))];
  const named = domains.filter(Boolean).join(', ');
  const description = named
    ? t('sender_tooltip', { domain: named })
    : t('sender_tooltip_no_domain');

  const chipClass = cn(
    'inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium leading-none',
    'border-warning/30 bg-warning/10 text-warning',
  );
  const content = (
    <>
      <Building className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {t('sender_label')}
    </>
  );

  if (!interactive) {
    return (
      <span data-external-sender-chip="" title={description} className={cn(chipClass, 'cursor-help', className)}>
        {content}
        <span className="sr-only">{` (${description})`}</span>
      </span>
    );
  }

  return (
    <span ref={wrapRef} className={cn('relative inline-flex flex-shrink-0', className)}>
      <button
        type="button"
        data-external-sender-chip=""
        title={description}
        aria-label={`${t('sender_label')}: ${description}`}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={(e) => {
          // The header around it folds or opens things on a click.
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className={cn(chipClass, 'cursor-pointer hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
      >
        {content}
      </button>
      {open && (
        <span
          id={popoverId}
          role="status"
          data-external-sender-detail=""
          className="absolute start-0 top-full z-30 mt-1 w-max max-w-[16rem] whitespace-normal rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
        >
          {description}
        </span>
      )}
    </span>
  );
}
