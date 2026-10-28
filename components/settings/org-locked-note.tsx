"use client";

import { useTranslations } from "next-intl";
import { Lock } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * "Set by your organisation", shown in place of the explanation-free
 * disabled control wherever an admin locked something: next to a
 * SettingItem's label, and in editors that aren't one (signature, templates,
 * sharing, tags).
 */
export function OrgLockedNote({ className }: { className?: string }) {
  const t = useTranslations("settings");
  return (
    <p className={cn("flex items-center gap-1 text-xs text-muted-foreground", className)} data-org-locked="">
      <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span>{t("org_locked")}</span>
    </p>
  );
}
