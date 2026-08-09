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

/** Every message that can be rendered for this person and tone, in a stable order. */
export function messagesFor({
  displayName,
  age,
  tone,
}: {
  displayName: string;
  age: number | null;
  tone: Tone;
}): string[] {
  const name = firstNameOf(displayName);

  return TEMPLATES.filter((t) => t.tone === tone)
    .filter((t) => !t.needsAge || age !== null)
    .map((t) => renderTemplate(t.text, { name, age }));
}
