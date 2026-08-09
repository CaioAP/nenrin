/**
 * What a person is, independent of how they are stored.
 *
 * This is the type screens and the scheduler work with. The database shape lives in
 * `src/db/schema.ts` and is translated at the repository boundary — so a column rename never
 * reaches a screen, and the domain never learns what SQLite is.
 */

import type { PartialDate } from './birthday';

/** Where a person came from. Mirrors the adapter ids in `src/sources/`. */
export const PERSON_SOURCES = ['manual', 'contacts', 'calendar', 'ask-link'] as const;
export type PersonSource = (typeof PERSON_SOURCES)[number];

export type Person = {
  id: string;
  displayName: string;
  birthday: PartialDate;
  notes: string | null;
  /** Per-person override for days of lead time. Null means "inherit". */
  leadDays: number | null;
  muted: boolean;
  source: PersonSource;
  /** The contact/event id this row was imported from, or null for manual entries. */
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * How many days early to remind about this person.
 *
 * Three levels, most specific first: the person's own override, then the longest lead time
 * among the groups they belong to, then the app default.
 *
 * Groups resolve to the *longest* lead, not the shortest or the first: if someone is in both
 * "Work" (same day) and "Close friends" (a week ahead), the user wants the week. Being
 * reminded too early is a minor annoyance; too late is the failure the app exists to prevent.
 */
export function resolveLeadDays(
  personLeadDays: number | null,
  groupLeadDays: (number | null)[],
  defaultLeadDays: number,
): number {
  if (personLeadDays !== null) return personLeadDays;

  const fromGroups = groupLeadDays.filter((days): days is number => days !== null);
  if (fromGroups.length > 0) return Math.max(...fromGroups);

  return defaultLeadDays;
}
