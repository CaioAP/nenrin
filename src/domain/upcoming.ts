/**
 * The Upcoming list: everyone ordered by how soon their birthday is.
 *
 * Separate from `armWindow` on purpose. The scheduler answers "what should the OS wake us
 * for", which is capped, lead-time-shifted and drops anything with no useful moment left.
 * This answers "what is coming up", which is uncapped and always includes today. Folding the
 * two together would mean the list quietly inherits the notification cap.
 */

import {
  ageAtNextOccurrence,
  DEFAULT_LEAP_DAY_POLICY,
  daysUntil,
  type LeapDayPolicy,
  nextOccurrence,
  startOfDay,
} from './birthday';
import type { Person } from './person';

export type UpcomingEntry = {
  person: Person;
  /** The calendar day being celebrated — already leap-day adjusted. */
  occursOn: Date;
  /** Whole days away; 0 means today. */
  daysAway: number;
  /** Age they are turning, or null when the birth year is unknown. */
  turningAge: number | null;
};

/**
 * Everyone, soonest first. Today's birthdays come first, not last.
 *
 * Ties break on name so the order is stable between renders — two people sharing a birthday
 * swapping places on every refresh looks like a bug.
 */
export function upcoming(
  people: Person[],
  from: Date,
  policy: LeapDayPolicy = DEFAULT_LEAP_DAY_POLICY,
): UpcomingEntry[] {
  const today = startOfDay(from);

  return people
    .map((person) => ({
      person,
      occursOn: nextOccurrence(person.birthday, today, policy),
      daysAway: daysUntil(person.birthday, today, policy),
      turningAge: ageAtNextOccurrence(person.birthday, today, policy),
    }))
    .sort(
      (a, b) => a.daysAway - b.daysAway || a.person.displayName.localeCompare(b.person.displayName),
    );
}

/** Human phrasing for how far away a birthday is. */
export function describeDaysAway(daysAway: number): string {
  if (daysAway === 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  if (daysAway < 7) return `In ${daysAway} days`;
  if (daysAway < 14) return 'Next week';
  return `In ${daysAway} days`;
}
