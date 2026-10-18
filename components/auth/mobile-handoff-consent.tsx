"use client";

import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface MobileHandoffConsentProps {
  /** The app link the browser will open, with the credential material in its fragment. */
  url: string | null;
  /** The account being handed over, for the explanation. */
  username: string;
  /** The user stays in the webmail instead. */
  onCancel: () => void;
}

/**
 * The step between a sign-in that was started with `mobile_redirect_uri` and
 * the navigation that hands its password or tokens to the mobile app. The
 * page otherwise reads exactly like the ordinary sign-in page, and a link
 * carrying that parameter is all it takes to open it; whoever owns the
 * `bulwarkmobile` scheme on the device receives whatever is handed over
 * (lib/auth/mobile-handoff.ts). Nothing leaves without this confirmation.
 */
export function MobileHandoffConsent({ url, username, onCancel }: MobileHandoffConsentProps) {
  const t = useTranslations("login");
  return (
    <ConfirmDialog
      isOpen={!!url}
      onClose={onCancel}
      onConfirm={() => {
        if (url) window.location.replace(url);
      }}
      title={t("mobile_handoff.title")}
      message={t("mobile_handoff.description", { username })}
      confirmText={t("mobile_handoff.confirm")}
      cancelText={t("mobile_handoff.cancel")}
    />
  );
}
