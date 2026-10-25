import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Kept apart from lib/utils, which imports the settings store: the plugin
// sandbox uses the app's Button and Input, and through lib/utils every
// sandbox frame loaded and ran ten app stores it never uses.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
