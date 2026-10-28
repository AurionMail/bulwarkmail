import { Loader2 } from "@/components/icons";
import { cn } from "@/lib/cn";

export interface SpinnerProps {
  /** sm w-4 (in a button or a row), md w-6 (a pane). Default md. */
  size?: "sm" | "md";
  /** Read out instead of being silent, e.g. "Loading messages". */
  label?: string;
  className?: string;
}

/** The loading spinner (R9): Loader2, spinning. */
export function Spinner({ size = "md", label, className }: SpinnerProps) {
  return (
    <Loader2
      className={cn("animate-spin text-muted-foreground flex-shrink-0", size === "sm" ? "w-4 h-4" : "w-6 h-6", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** A whole pane that is loading: one centred md spinner. */
export function PaneSpinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-1 items-center justify-center p-8 h-full", className)}>
      <Spinner size="md" label={label} />
    </div>
  );
}
