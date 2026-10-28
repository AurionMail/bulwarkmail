"use client";

import { AlertCircle, RefreshCw } from "@/components/icons";
import type { AppIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { getPathPrefix } from "@/lib/browser-navigation";
import { cn } from "@/lib/utils";
import type { FallbackProps } from "./error-boundary";

export interface ErrorStateProps {
  title: string;
  description?: string;
  /** Puts the part back together: re-renders it, or reloads the route. */
  onRetry: () => void;
  retryLabel: string;
  /** Offers a way out to the inbox; left out inside mail itself. */
  homeLabel?: string;
  icon?: AppIcon;
  className?: string;
}

/**
 * The one error fallback: icon, title, a line of text, "Try again", and "Go
 * to inbox" where the inbox is somewhere else. Every error boundary draws
 * this, at whatever size its pane has.
 */
export function ErrorState({ title, description, onRetry, retryLabel, homeLabel, icon: Icon = AlertCircle, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn("flex flex-1 h-full flex-col items-center justify-center p-8 text-center bg-background", className)}>
      <div className="w-12 h-12 mb-4 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
        <Icon className="w-6 h-6 text-red-600 dark:text-red-400" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mb-6 max-w-md">{description}</p>}
      <div className={cn("flex flex-wrap gap-3 justify-center", !description && "mt-4")}>
        {homeLabel && (
          // A full load: whatever broke starts over.
          <a
            href={`${getPathPrefix()}/`}
            className="inline-flex items-center justify-center h-9 px-3 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {homeLabel}
          </a>
        )}
        <Button size="sm" onClick={onRetry}>
          <RefreshCw className="w-4 h-4 me-2" />
          {retryLabel}
        </Button>
      </div>
    </div>
  );
}

/** Full-page error fallback, also used around each app (AppErrorBoundary). */
export function PageErrorFallback({ resetError, t }: FallbackProps) {
  return (
    <ErrorState
      title={t("page_error_title")}
      description={t("page_error_description")}
      onRetry={resetError}
      retryLabel={t("try_again")}
      homeLabel={t("go_home")}
    />
  );
}

/** Mail's folder sidebar (256px wide). */
export function SidebarErrorFallback({ resetError, t }: FallbackProps) {
  return (
    <ErrorState className="w-64 flex-none border-e border-border bg-secondary p-4" title={t("sidebar_error")} onRetry={resetError} retryLabel={t("try_again")} />
  );
}

/** Mail's message list. */
export function EmailListErrorFallback({ resetError, t }: FallbackProps) {
  return <ErrorState className="w-full p-4" title={t("email_list_error")} onRetry={resetError} retryLabel={t("try_again")} />;
}

/** Mail's reading pane. */
export function EmailViewerErrorFallback({ resetError, t }: FallbackProps) {
  return (
    <ErrorState
      title={t("viewer_error_title")}
      description={t("viewer_error_description")}
      onRetry={resetError}
      retryLabel={t("try_again")}
    />
  );
}

/** The composer. */
export function ComposerErrorFallback({ resetError, t }: FallbackProps) {
  return <ErrorState className="border rounded-lg" title={t("composer_error")} onRetry={resetError} retryLabel={t("try_again")} />;
}

/** Settings. */
export function SettingsErrorFallback({ resetError, t }: FallbackProps) {
  return (
    <ErrorState
      title={t("settings_error_title")}
      description={t("settings_error_description")}
      onRetry={resetError}
      retryLabel={t("try_again")}
      homeLabel={t("go_home")}
    />
  );
}
