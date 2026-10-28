import { notFound } from 'next/navigation';

// Unknown paths below a locale (/de/typo) end here, so the 404 renders
// inside the locale layout and is translated ([locale]/not-found.tsx).
// Removed from the static Lite export, like (main)/[...rest].
export default function LocaleCatchAll() {
  notFound();
}
