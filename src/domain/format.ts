/**
 * Display formatting for birthdays.
 *
 * Month names are hardcoded English rather than pulled from `Intl`. The app is English-only
 * in v1, and `Intl` output varies by platform and locale — which would make these functions
 * untestable in the one place the whole list's readability is decided. When localisation
 * arrives this is the single file to replace.
 */

import type { PartialDate } from './birthday';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const SHORT_MONTHS = MONTH_NAMES.map((month) => month.slice(0, 3));
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "14 March", or "14 March 1988" when the year is known. */
export function formatBirthday(birthday: PartialDate): string {
  const monthDay = `${birthday.day} ${MONTH_NAMES[birthday.month - 1]}`;
  return birthday.year === null ? monthDay : `${monthDay} ${birthday.year}`;
}

/** "14 Mar" — the compact form for a list row. */
export function formatMonthDayShort(birthday: PartialDate): string {
  return `${birthday.day} ${SHORT_MONTHS[birthday.month - 1]}`;
}

/** "Sat, 14 Mar" — for a concrete upcoming date, where the weekday is the useful part. */
export function formatOccursOn(date: Date): string {
  return `${SHORT_DAYS[date.getDay()]}, ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

/**
 * "turning 38", or null when the birth year is unknown.
 *
 * Returns null rather than an empty string so a caller cannot accidentally render a stray
 * separator around nothing.
 */
export function formatTurningAge(turningAge: number | null): string | null {
  return turningAge === null ? null : `turning ${turningAge}`;
}
