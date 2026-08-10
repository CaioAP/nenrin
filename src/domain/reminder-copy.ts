/**
 * The words that appear on a notification.
 *
 * Here rather than in `src/notifications/` because it is pure text over plain objects, and
 * this is the one part of a notification that can be checked without a device. What the
 * user actually reads is worth a test; the twenty lines of Expo plumbing around it are not.
 */

import { startOfDay } from './birthday';
import { formatOccursOn } from './format';
import type { Reminder } from './schedule';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * "Ana’s", "Lucas’".
 *
 * A name already ending in s takes a bare apostrophe. Both forms are defensible in modern
 * English, but "Lucas’s birthday" reads as a typo to enough people to be worth the branch.
 * The apostrophe is typographic (’), matching the rest of the app's copy.
 */
export function possessive(name: string): string {
  return name.endsWith('s') || name.endsWith('S') ? `${name}’` : `${name}’s`;
}

/**
 * Whole days between two calendar days.
 *
 * Both ends are collapsed to midnight before subtracting, and the result is rounded, for the
 * same reason `daysUntil` does it: across a daylight-saving boundary the span is 23 or 25
 * hours, and a truncating division turns "in 7 days" into "in 6 days".
 */
function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/**
 * Title and body for one armed reminder.
 *
 * The title carries the urgency, because on a locked screen it is often all that is shown.
 * The body carries the date and — only when the birth year is known — the age, so a person
 * added without a year never produces "turning null".
 */
export function reminderCopy(reminder: Reminder): { title: string; body: string } {
  const daysAway = daysBetween(reminder.fireAt, reminder.occursOn);
  const name = possessive(reminder.displayName);

  const when = daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`;

  const date = formatOccursOn(reminder.occursOn);
  const body = reminder.turningAge === null ? date : `${date} · turning ${reminder.turningAge}`;

  return { title: `${name} birthday is ${when}`, body };
}
