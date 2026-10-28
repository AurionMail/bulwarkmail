import * as React from "react";
import { cn } from "@/lib/cn";

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline" | "destructive";
  size?: ButtonSize;
}

// An icon without a size class of its own gets the size R1 gives it. The
// :where() keeps the rule at the specificity of a bare `svg`, so a `w-5` on
// the icon still wins.
const SIZES: Record<ButtonSize, string> = {
  xs: "h-8 px-2.5 text-sm [:where(&)_svg]:size-4",
  sm: "h-9 px-3 text-sm",
  md: "h-10 px-4 py-2",
  lg: "h-11 px-8",
  icon: "h-10 w-10",
  "icon-sm": "h-8 w-8 [:where(&)_svg]:size-4",
  "icon-lg": "h-11 w-11 [:where(&)_svg]:size-5",
};

// On a touch screen every button can be hit within 44x44 px, whatever size
// it is drawn at: a transparent ::after, centred on the button, at least
// that big. `relative` gives it something to centre on; a className with
// another position (absolute, fixed, sticky) replaces it through
// tailwind-merge and still holds the ::after.
const TOUCH_HIT_AREA =
  "relative pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 " +
  "pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 " +
  "pointer-coarse:after:-translate-x-1/2 pointer-coarse:after:-translate-y-1/2";

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center rounded-md font-medium transition-all duration-200",
          TOUCH_HIT_AREA,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          {
            default:
              "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm hover:shadow",
            ghost: "hover:bg-accent hover:text-accent-foreground",
            outline:
              "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
            destructive:
              "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
          }[variant],
          SIZES[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
