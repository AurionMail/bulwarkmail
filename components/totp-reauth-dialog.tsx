"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useTotpReauthStore } from "@/stores/totp-reauth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Shield } from "@/components/icons";

/**
 * Asks for a fresh TOTP code when a 2FA session expires (TOTP rotates every
 * ~30 seconds).
 *
 * Mounted once in the locale layout, so the prompt opens in whichever app
 * made the request. The JMAP client opens it through useTotpReauthStore
 * when a 401 comes back on a TOTP-authenticated session.
 */
export function TotpReauthDialog() {
  const t = useTranslations("totp_reauth");
  const tCommon = useTranslations("common");
  const { isOpen, submit, cancel } = useTotpReauthStore();
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) setCode("");
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length >= 6) submit(code);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={cancel}
      title={t("title")}
      description={t("description")}
      icon={
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 flex-shrink-0">
          <Shield className="w-5 h-5 text-primary" />
        </div>
      }
      size="sm"
      showClose={false}
      dirty={code.length > 0}
      initialFocus={inputRef}
      onSubmit={handleSubmit}
      footer={
        <>
          <Button type="button" variant="outline" onClick={cancel}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={code.length < 6}>
            {t("verify")}
          </Button>
        </>
      }
    >
      <p className="mt-3 mb-4 text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
        {t("oauth_hint")}
      </p>
      <Input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className="h-12 text-center font-mono tracking-widest text-lg"
        placeholder="000000"
        autoComplete="one-time-code"
        aria-label={t("code_label")}
      />
    </Dialog>
  );
}
