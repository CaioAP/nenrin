/**
 * An event title → the person's name inside it.
 *
 * Pure. No Expo, no dates, no database.
 *
 * The title is the only signal there is. Birthday events sit in the user's *primary*
 * calendar — Google Calendar's "Birthdays" heading corresponds to no row in
 * `CalendarContract`, and Samsung's real `local.samsungbirthday` calendar is empty — so
 * matching on calendar identity finds none of them. No field carries the name either.
 *
 * **The wording follows the Google account's language, not the device's.** `"Mãe's birthday"`
 * came off a phone whose entire UI is Portuguese. A parser keyed to `Intl`, to the device
 * locale, or to `expo-localization` would be wrong on exactly the device this was measured
 * on, so the list below is a fixed multilingual set rather than a locale lookup.
 */

export type ParsedBirthdayTitle = {
  displayName: string;
  /** False when no pattern matched and the whole title was kept. The deck flags these. */
  confident: boolean;
};

/**
 * Is this a birthday at all?
 *
 * Separate from the extraction patterns, because this is the gate that decides `null` versus
 * `confident: false` — and it is where a loose match does damage. `niver` needs `\b` on both
 * sides: without it `Confraternização Universal` is a person, which the probe demonstrated.
 * `anivers` catches `aniversário`, which `\bniver\b` deliberately does not.
 */
const BIRTHDAY_WORDS = [
  /birthday/i,
  /\bb-?day\b/i,
  /anivers/i,
  /\bniver\b/i,
  /cumplea/i,
  /geburtstag/i,
  /compleanno/i,
  /anniversaire/i,
];

/**
 * Title shapes, first match wins. Group 1 is the name.
 *
 * Both apostrophes: Google writes the curly `'`, keyboards write the straight `'`, and a
 * parser that knows only one silently falls through to the unconfident branch for half the
 * events on a device.
 *
 * `(.+)` is greedy on purpose — `"Jaque 💜∞'s birthday"` must keep the emoji. Nothing here
 * tries to identify what a name looks like; the user is going to see it in an editable field.
 */
const NAME_PATTERNS = [
  /^(.+)['’]s\s+birthday$/i,
  /^(.+)['’]\s+birthday$/i,
  /^anivers[áa]rio\s+de\s+(.+)$/i,
  /^niver\s+de\s+(.+)$/i,
  /^cumplea[ñn]os\s+de\s+(.+)$/i,
  /^geburtstag\s+von\s+(.+)$/i,
  /^anniversaire\s+de\s+(.+)$/i,
  /^compleanno\s+di\s+(.+)$/i,
  /^(.+)\s+geburtstag$/i,
];

/** Null when the title is not a birthday at all. */
export function parseBirthdayTitle(title: string): ParsedBirthdayTitle | null {
  const trimmed = title.trim();
  if (trimmed === '') return null;
  if (!BIRTHDAY_WORDS.some((word) => word.test(trimmed))) return null;

  for (const pattern of NAME_PATTERNS) {
    const name = pattern.exec(trimmed)?.[1]?.trim();
    if (name) return { displayName: name, confident: true };
  }

  // A birthday whose wording nobody anticipated. Kept, not dropped — the alternative loses
  // real people with no trace, which is the same silent-loss shape as the visibility trap.
  return { displayName: trimmed, confident: false };
}
