// One notation for key combinations in the help modal and in hints: "Mod"
// (and the older "Ctrl/⌘", "Ctrl/Cmd" forms) is ⌘ on Apple devices and Ctrl
// everywhere else; Alt is ⌥ on Apple devices. Entries are written with
// "Mod + K", "Shift + Mod + Enter", alternatives separated by " / ".

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const MOD = /^(mod|ctrl\/⌘|ctrl\/cmd|cmd\/ctrl|⌘\/ctrl)$/i;

/** One key or combination ("Mod + Enter") in the notation of this platform. */
export function formatShortcutCombo(combo: string, apple = isApplePlatform()): string {
  // Keeps the spacing it was written with ("Ctrl+Shift+Y" from a plugin).
  const separator = /\s\+\s/.test(combo) ? " + " : "+";
  return combo
    .split(/\s*\+\s*/)
    .map((part) => {
      if (MOD.test(part)) return apple ? '⌘' : 'Ctrl';
      if (/^ctrl$/i.test(part)) return apple ? '⌘' : 'Ctrl';
      if (/^(cmd|⌘)$/i.test(part)) return apple ? '⌘' : 'Ctrl';
      if (/^alt$/i.test(part)) return apple ? '⌥' : 'Alt';
      return part;
    })
    .join(separator);
}

/** The alternatives of a shortcut ("j / ↓"), each in the notation of this platform. */
export function shortcutAlternatives(key: string, apple = isApplePlatform()): string[] {
  return key.split(' / ').map((combo) => formatShortcutCombo(combo, apple));
}
