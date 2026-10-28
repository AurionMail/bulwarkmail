"use client";

import { useTranslations } from "next-intl";
import type { Identity } from "@/lib/jmap/types";
import { sanitizeSignatureHtmlForDisplay } from "@/lib/email-sanitization";
import { getPlainTextSignature } from "@/lib/signature-utils";
import { useOrgDisclaimer } from "@/hooks/use-org-signature";

/**
 * The admin's disclaimer under the composer's editor, read-only, with
 * "Added when you send". It is added by the send finaliser
 * (lib/org/outgoing.ts), so it is never part of the body or a draft.
 */
export function OrgDisclaimerPreview({ sending, plainText }: {
  sending: Pick<Identity, "name" | "email"> | null | undefined;
  plainText: boolean;
}) {
  const t = useTranslations("org_signature");
  const disclaimer = useOrgDisclaimer(sending);
  if (!disclaimer) return null;
  const html = !plainText && disclaimer.html ? sanitizeSignatureHtmlForDisplay(disclaimer.html) : "";
  return (
    <div
      className="mx-4 mb-3 border-t border-border pt-2 text-xs text-muted-foreground break-words"
      data-testid="org-disclaimer-preview"
    >
      <p className="mb-1 font-medium">{t("disclaimer_added_on_send")}</p>
      {html ? (
        <div className="[&_a]:underline min-w-0" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="whitespace-pre-wrap min-w-0">{getPlainTextSignature({ textSignature: disclaimer.text, htmlSignature: disclaimer.html })}</div>
      )}
    </div>
  );
}
