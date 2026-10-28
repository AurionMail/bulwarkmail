"use client";

import { useDeferredValue, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Identity } from "@/lib/jmap/types";
import { sanitizeSignatureHtmlForDisplay } from "@/lib/email-sanitization";
import { getPlainTextSignature } from "@/lib/signature-utils";
import { htmlCarriesDisclaimer, textCarriesDisclaimer } from "@/lib/org/body-match";
import { useOrgDisclaimer } from "@/hooks/use-org-signature";

/**
 * The admin's disclaimer under the composer's editor, read-only, with
 * "Added when you send". It is added by the send finaliser
 * (lib/org/outgoing.ts), so it is never part of the body or a draft. A body
 * that already ends with it (a message back from Undo) gets no second copy
 * on send, so the block isn't shown then either.
 */
export function OrgDisclaimerPreview({ sending, plainText, body = "" }: {
  sending: Pick<Identity, "name" | "email"> | null | undefined;
  plainText: boolean;
  /** The composer's body: HTML, or text in plain-text mode. */
  body?: string;
}) {
  const t = useTranslations("org_signature");
  const disclaimer = useOrgDisclaimer(sending);
  // Parsing the body on every keystroke isn't needed for a hint.
  const deferredBody = useDeferredValue(body);
  const carried = useMemo(
    () => !!disclaimer && !!deferredBody && (plainText
      ? textCarriesDisclaimer(deferredBody, disclaimer)
      : htmlCarriesDisclaimer(deferredBody, disclaimer)),
    [disclaimer, deferredBody, plainText],
  );
  if (!disclaimer || carried) return null;
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
