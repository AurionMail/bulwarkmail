"use client";

import { useTranslations } from "next-intl";
import { NotFoundView } from "@/components/error/not-found-view";

export default function LocaleNotFound() {
  const t = useTranslations("not_found");
  const tErrors = useTranslations("errors");
  return <NotFoundView title={t("title")} description={t("description")} homeLabel={tErrors("go_home")} />;
}
