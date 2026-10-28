import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

export interface IconButtonProps extends Omit<ButtonProps, "aria-label"> {
  /** What the button does. Becomes the accessible name and the tooltip. */
  label: string;
  /** The icon. It gets w-4 in icon-sm and w-5 in icon-lg unless it sets its own size. */
  children: React.ReactNode;
}

/**
 * An icon-only button (R1): ghost, 32px (`icon-sm`) unless told otherwise,
 * always named. `title` defaults to the label; pass `title=""` to drop the
 * tooltip where another one already shows.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, variant = "ghost", size = "icon-sm", type = "button", title, children, ...props }, ref) => (
    <Button
      ref={ref}
      type={type}
      variant={variant}
      size={size}
      aria-label={label}
      title={title ?? label}
      {...props}
    >
      {children}
    </Button>
  )
);
IconButton.displayName = "IconButton";

export { IconButton };
