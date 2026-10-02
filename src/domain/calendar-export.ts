/**
 * What Nenrin's calendar should contain, and what to change to get it there.
 *
 * Pure. No Expo, no database. The adapter in `src/export/` turns an `ExportEvent` into an
 * `expo-calendar` call; everything that decides *which* events, on *which* day, with *which*
 * words, is here and tested in Node.
 *
 * **One event per person, recurring yearly — except 29 February.** A yearly recurrence is
 * the honest shape for a birthday, and it is what a user expects to find in their calendar.
 * But a yearly `RRULE` anchored on 29 February asks the platform what that date means in a
 * common year, and the answer is not ours: RFC 5545 skips the invalid date, so on Android it
 * fires one year in four. iOS could express "last day of February" with `BYMONTHDAY=-1`, but
 * `expo-calendar`'s Android recurrence carries only frequency, interval, count and end date.
 * So leap-day birthdays export as one-shot events on dates `occurrenceInYear` has already
 * resolved under the user's `LeapDayPolicy` — the same answer notifications give, and for the
 * same reason: the OS is never asked what 29 February means.
 */

import { type LeapDayPolicy, occurrenceInYear, type PartialDate } from './birthday';
import type { CalendarDay } from './calendar-date';
import { possessive } from './reminder-copy';

/** The fields of a person the calendar needs. */
export type ExportablePerson = {
  id: string;
  displayName: string;
  birthday: PartialDate;
};

export type ExportEvent = {
  personId: string;
  title: string;
  notes: string;
  /** The first occurrence. For a yearly event, the anchor its recurrence expands from. */
  day: CalendarDay;
  recurrence: 'yearly' | 'once';
};

/** An event already written, as the database remembers it. */
export type ExportedEvent = {
  eventId: string;
  fingerprint: string;
};

export type ExportPlan = {
  create: ExportEvent[];
  /** Event ids to delete. */
  remove: string[];
};

/**
 * Where a yearly event starts when the birth year is unknown.
 *
 * A fixed year rather than the current one, so the event's own fields do not change on
 * 1 January — an anchor that moved with the clock would delete and rewrite every birthday in
 * the calendar once a year for nothing. A leap year, so it is never itself the question this
 * file avoids asking; 29 February never reaches it anyway.
 */
export const UNKNOWN_YEAR_ANCHOR = 2000;

/**
 * How many years of one-shot events a 29 February birthday gets, counting this one.
 *
 * Eight covers two leap years. The window slides on every sync — re-run on every foreground
 * and every write, like the notification window — so it only has to outlast a long stretch
 * of not opening the app, not forever.
 */
export const LEAP_DAY_HORIZON_YEARS = 8;

const isLeapDay = (birthday: PartialDate) => birthday.month === 2 && birthday.day === 29;

/**
 * Every event the calendar should hold.
 *
 * Muted people are exported too. Muting is about notifications; a muted person's birthday is
 * still a birthday, and the calendar is somewhere the user looks on purpose.
 */
export function exportEventsFor(
  people: readonly ExportablePerson[],
  options: { today: Date; policy: LeapDayPolicy },
): ExportEvent[] {
  return people.flatMap((person): ExportEvent[] => {
    const title = `${possessive(person.displayName)} birthday`;
    const notes = notesFor(person.birthday);

    if (!isLeapDay(person.birthday)) {
      return [
        {
          personId: person.id,
          title,
          notes,
          day: {
            // The birth year when known, so the series does not begin before the person did.
            year: person.birthday.year ?? UNKNOWN_YEAR_ANCHOR,
            month: person.birthday.month,
            day: person.birthday.day,
          },
          recurrence: 'yearly',
        },
      ];
    }

    const firstYear = options.today.getFullYear();
    return Array.from({ length: LEAP_DAY_HORIZON_YEARS }, (_, offset) => {
      const date = occurrenceInYear(person.birthday, firstYear + offset, options.policy);
      return {
        personId: person.id,
        title,
        notes,
        day: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() },
        recurrence: 'once',
      };
    });
  });
}

/**
 * No age in the title. A recurring event has one title for every year, so "turning 38" would
 * be right once. The birth year goes in the notes instead, where it stays true.
 */
function notesFor(birthday: PartialDate): string {
  const managed = 'Added by Nenrin. Edit the birthday in Nenrin: changes made here are replaced.';
  return birthday.year === null ? managed : `Born ${birthday.year}.\n\n${managed}`;
}

/**
 * Everything that, if it changed, means the written event is wrong.
 *
 * Including the person id, so two people with the same name and birthday are two events
 * rather than one that both claim.
 */
export function fingerprintOf(event: ExportEvent): string {
  const { personId, title, notes, day, recurrence } = event;
  return JSON.stringify([personId, title, notes, day.year, day.month, day.day, recurrence]);
}

/**
 * The smallest set of writes that turns what is in the calendar into what should be.
 *
 * Create and delete only, never update. A changed birthday is a delete and a create: an
 * in-place update of a recurring event is the operation whose semantics differ most between
 * the two platforms (Android rewrites the master row; EventKit needs a span), and a birthday
 * changes rarely enough that the extra write costs nothing.
 *
 * Matching is by fingerprint, one-for-one. A fingerprint the database holds twice — which
 * only a crash between a create and its bookkeeping could produce — keeps one event and
 * removes the other.
 */
export function planExportSync(
  desired: readonly ExportEvent[],
  existing: readonly ExportedEvent[],
): ExportPlan {
  const unmatched = new Map<string, string[]>();
  for (const { eventId, fingerprint } of existing) {
    const ids = unmatched.get(fingerprint);
    if (ids) ids.push(eventId);
    else unmatched.set(fingerprint, [eventId]);
  }

  const create: ExportEvent[] = [];
  for (const event of desired) {
    const ids = unmatched.get(fingerprintOf(event));
    if (ids && ids.length > 0) ids.shift();
    else create.push(event);
  }

  return { create, remove: [...unmatched.values()].flat() };
}
