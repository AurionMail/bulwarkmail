import type { ReactNode } from "react";
import type { AppIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  /** Drawn in a muted circle above the title. */
  icon?: AppIcon;
  title: ReactNode;
  /** One line under the title: why it is empty or what to do. */
  description?: ReactNode;
  /**
   * Buttons under the text: the create action as `<Button size="sm">`, a
   * secondary one (Clear search) as `<Button variant="outline" size="sm">`.
   */
  actions?: ReactNode;
  /** Less padding, for a narrow pane or a popover. */
  compact?: boolean;
  className?: string;
}

/**
 * A list or pane with nothing in it (R9), the same as the plugin kit's
 * EmptyState: icon in a muted circle, title, one line, actions.
 */
export function EmptyState({ icon: Icon, title, description, actions, compact = false, className }: EmptyStateProps) {
  return (
    <div className={cn("flex items-center justify-center", compact ? "p-6" : "min-h-[18rem] p-8", className)}>
      <div className="flex flex-col items-center text-center max-w-sm">
        {Icon && (
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
            <Icon className="w-7 h-7 text-muted-foreground" aria-hidden="true" />
          </div>
        )}
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        {actions && <div className="flex gap-2 flex-wrap justify-center mt-5">{actions}</div>}
      </div>
    </div>
  );
}
