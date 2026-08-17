/**
 * Suggested birthday messages.
 *
 * The point is not to write greetings for people — it is to remove the small friction that
 * makes you put the message off until the day is over. Copy, edit a word, send.
 *
 * Pure and deterministic: this returns every applicable message in a stable order, and the
 * UI decides what to show and in what order. Randomness in here would make it untestable
 * for no gain.
 */

export type Tone = 'family' | 'close' | 'colleague';

export type Template = {
  id: string;
  tone: Tone;
  text: string;
  /** True when the text uses {age} and so cannot be rendered without a birth year. */
  needsAge: boolean;
};

export type MessageVars = {
  name: string;
  age: number | null;
};

const template = (id: string, tone: Tone, text: string): Template => ({
  id,
  tone,
  text,
  needsAge: text.includes('{age}'),
});

export const TEMPLATES: Template[] = [
  template('family-warm', 'family', 'Happy birthday, {name}! Wishing you a wonderful year ahead.'),
  template('family-love', 'family', 'Happy birthday {name} — so much love to you today.'),
  template('family-thinking', 'family', 'Thinking of you today, {name}. Happy birthday!'),
  template('family-age', 'family', 'Happy {age}th, {name}! Hope today is a good one.'),

  template('close-plain', 'close', 'Happy birthday, {name}!'),
  template('close-celebrate', 'close', '{name}! Happy birthday — hope you get properly spoiled.'),
  template('close-catchup', 'close', 'Happy birthday {name}! We are overdue a catch-up.'),
  template('close-age', 'close', '{age} on you, {name}. Happy birthday!'),

  template('colleague-simple', 'colleague', 'Happy birthday, {name}! Have a great day.'),
  template(
    'colleague-year',
    'colleague',
    'Happy birthday {name} — wishing you a great year ahead.',
  ),
  template('colleague-age', 'colleague', 'Happy {age}th birthday, {name}! Enjoy the day.'),
];

/**
 * The first word of a name.
 *
 * Contacts arrive as full names, and a message opening with someone's full legal name reads
 * like a letter from a bank.
 */
export function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? '';
}

/**
 * Substitutes {name} and {age}. Unknown placeholders are left alone.
 *
 * Throws rather than rendering a missing age. Printing "Turning null!" is precisely the bug
 * that nullable birth years invite, so it is made impossible instead of merely unlikely.
 */
export function renderTemplate(text: string, vars: MessageVars): string {
  if (text.includes('{age}') && vars.age === null) {
    throw new Error('Template needs an age, but the birth year is unknown');
  }

  return text
    .replaceAll('{name}', vars.name)
    .replaceAll('{age}', vars.age === null ? '' : String(vars.age));
}

/**
 * The tone a person opens on before anyone has chosen one for them.
 *
 * Applied on read rather than written into the column, so "never chosen" stays
 * distinguishable from "deliberately close" — which is what lets a future groups-derived
 * tone fill in only where the user has not decided.
 */
export const DEFAULT_TONE: Tone = 'close';

/** A rendered message and the template it came from. */
export type MessageOption = { id: string; text: string };

/**
 * Every message that can be rendered for this person and tone, in a stable order.
 *
 * The id travels with the text because the screen lets you pick one message and then edit
 * it. An array index would be a fine handle right up until the tone changes underneath it,
 * at which point it silently points at a different message.
 */
export function messageOptions({
  displayName,
  age,
  tone,
}: {
  displayName: string;
  age: number | null;
  tone: Tone;
}): MessageOption[] {
  const name = firstNameOf(displayName);

  return TEMPLATES.filter((t) => t.tone === tone)
    .filter((t) => !t.needsAge || age !== null)
    .map((t) => ({ id: t.id, text: renderTemplate(t.text, { name, age }) }));
}

/** The same messages as plain strings, for callers with nothing to select. */
export function messagesFor(args: {
  displayName: string;
  age: number | null;
  tone: Tone;
}): string[] {
  return messageOptions(args).map((option) => option.text);
}
