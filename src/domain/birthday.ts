/**
 * Birthday arithmetic. Pure TypeScript — no Expo, no React Native, no database.
 *
 * Two things drive every design choice in this file:
 *
 * 1. **Most birthdays have no year.** You know it is 14 March; you do not know if they were
 *    born in 1988. `year` is therefore nullable everywhere and age is `number | null`, so a
 *    missing year is impossible to forget at a call site.
 * 2. **All arithmetic is local-calendar arithmetic.** A birthday is a calendar day, not an
 *    instant. Everything is built on local midnight; nothing here touches UTC.
 */

/** A birthday: always a month and day, optionally a year. */
export type PartialDate = {
  /** 1–12. */
  month: number;
  /** 1–31, validated against the month. */
  day: number;
  /** Four-digit birth year, or null when unknown. */
  year: number | null;
};

/**
 * What to do with a 29 February birthday in a common year.
 *
 * There is no correct answer — it is a preference, so it is a parameter rather than a
 * constant. Default is `feb28`: it keeps the birthday in the right month, which is what
 * most people with a leap-day birthday do.
 */
export type LeapDayPolicy = 'feb28' | 'mar1';

export const DEFAULT_LEAP_DAY_POLICY: LeapDayPolicy = 'feb28';

const MS_PER_DAY = 86_400_000;
const EARLIEST_BIRTH_YEAR = 1800;
const LATEST_BIRTH_YEAR = 2200;

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Days in a month, treating February as 29 so leap-day birthdays are storable. */
const maxDayInMonth = (month: number) =>
  [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

export function isValidMonthDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= maxDayInMonth(month);
}

export function makePartialDate(month: number, day: number, year?: number | null): PartialDate {
  if (!isValidMonthDay(month, day)) {
    throw new RangeError(`Not a real date: month ${month}, day ${day}`);
  }
  if (year !== undefined && year !== null) {
    if (!Number.isInteger(year) || year < EARLIEST_BIRTH_YEAR || year > LATEST_BIRTH_YEAR) {
      throw new RangeError(`Not a plausible birth year: ${year}`);
    }
  }
  return { month, day, year: year ?? null };
}

/** Local midnight of the calendar day `date` falls on. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * The date this birthday is observed on in a given calendar year.
 *
 * Only 29 February is ever adjusted. Note the explicit month check afterwards: passing day 29
 * to `new Date(y, 1, 29)` in a common year silently rolls over to 1 March, which would make
 * the `feb28` policy a lie.
 */
export function occurrenceInYear(
  birthday: PartialDate,
  year: number,
  policy: LeapDayPolicy = DEFAULT_LEAP_DAY_POLICY,
): Date {
  const isLeapDayBirthday = birthday.month === 2 && birthday.day === 29;

  if (isLeapDayBirthday && !isLeapYear(year)) {
    return policy === 'mar1' ? new Date(year, 2, 1) : new Date(year, 1, 28);
  }

  return new Date(year, birthday.month - 1, birthday.day);
}

/**
 * The next date this birthday is observed on, at or after the calendar day of `from`.
 *
 * A birthday happening *today* has not passed — it returns today. That matters for the
 * "Upcoming" list, where a birthday disappearing on the morning of the day is the one bug
 * users would actually notice.
 */
export function nextOccurrence(
  birthday: PartialDate,
  from: Date,
  policy: LeapDayPolicy = DEFAULT_LEAP_DAY_POLICY,
): Date {
  const today = startOfDay(from);
  const thisYear = occurrenceInYear(birthday, today.getFullYear(), policy);
  if (thisYear.getTime() >= today.getTime()) return thisYear;
  return occurrenceInYear(birthday, today.getFullYear() + 1, policy);
}

/**
 * Whole days from `from` to the next occurrence; 0 on the day itself.
 *
 * Rounded rather than floored: local midnights are 23 or 25 hours apart across a
 * daylight-saving transition, and flooring the raw division loses a day.
 */
export function daysUntil(
  birthday: PartialDate,
  from: Date,
  policy: LeapDayPolicy = DEFAULT_LEAP_DAY_POLICY,
): number {
  const target = nextOccurrence(birthday, from, policy);
  return Math.round((target.getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** Age on a given date, or null when the birth year is unknown. */
export function ageOn(
  birthday: PartialDate,
  on: Date,
  policy: LeapDayPolicy = DEFAULT_LEAP_DAY_POLICY,
): number | null {
  if (birthday.year === null) return null;

  const day = startOfDay(on);
  const thisYear = occurrenceInYear(birthday, day.getFullYear(), policy);
  const hasHadBirthday = day.getTime() >= thisYear.getTime();

  return day.getFullYear() - birthday.year - (hasHadBirthday ? 0 : 1);
}

/** The age they are about to turn — what a "turning 38" message needs. */
export function ageAtNextOccurrence(
  birthday: PartialDate,
  from: Date,
  policy: LeapDayPolicy = DEFAULT_LEAP_DAY_POLICY,
): number | null {
  if (birthday.year === null) return null;
  return nextOccurrence(birthday, from, policy).getFullYear() - birthday.year;
}
