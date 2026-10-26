/**
 * Unicode directional formatting characters: the explicit embeddings,
 * overrides and isolates (U+202A-202E, U+2066-2069) and the LRM/RLM marks.
 * In a sender-controlled name they reorder what the reader sees, so
 * `report‮fdp.exe` shows as `reportexe.pdf`.
 */
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g;

/** `text` without directional formatting characters, for display. */
export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}
