/**
 * An all-day event's start → the calendar day it means.
 *
 * Pure. An all-day event does not begin at a moment, it occupies a date — but `expo-calendar`
 * hands its start over as an absolute instant, so the date has been *encoded* as one. This
 * undoes the encoding and hands back three integers. Nothing downstream of here touches a
 * time zone: `PartialDate` has none, the birthday renders as the same day everywhere, and the
 * reminder fires on the user's own local morning. This is not arithmetic.
 *
 * The encoding differs by platform, which is why `encoding` is an argument rather than a
 * fact this file knows. It is chosen from `Platform.OS` in `src/sources/calendar.ts`, the same
 * way `src/export/calendar.ts` chooses it for `allDayRange`:
 *
 * - `'utc-midnight'` — Android. All-day events are stored as UTC midnight: a birthday on
 *   25 January arrives as `2027-01-25T00:00:00.000Z`. **This is the one place in the codebase
 *   where UTC getters are correct**, despite AGENTS.md saying the opposite everywhere else.
 *   Local getters in São Paulo (UTC−3) would read 24 January — every date off by one for
 *   every user west of Greenwich, permanently and silently.
 * - `'local-midnight'` — iOS. `expo-calendar` serializes `EKEvent.startDate` through a
 *   formatter pinned to UTC (`ios/Conversions/Conversions.swift`), but EventKit begins an
 *   all-day event at *local* midnight. In UTC+9 a 25 January birthday arrives as
 *   `2027-01-24T15:00:00.000Z`; UTC getters read the 24th. Local getters undo it. The mirror
 *   image of the Android bug: it breaks *east* of Greenwich, so São Paulo cannot see it.
 *   **Unverified on a device** — there is no iOS build yet, only the Swift source.
 *
 * Neither test zone sees everything. `TZ=Europe/London` is UTC+0 in January, where the two
 * getters agree; in July it is UTC+1, which catches the iOS bug but not the Android one.
 * `TZ=America/Sao_Paulo` (UTC−3) catches the Android bug and is blind to the iOS one. The
 * tests are written so each encoding is exercised in a zone that can fail it.
 */

import { makePartialDate, type PartialDate } from './birthday';

/** Null when the input is unparseable. */
export function partialDateFromAllDayStart(
  startDate: string | Date,
  encoding: AllDayEncoding,
): PartialDate | null {
  const instant = typeof startDate === 'string' ? new Date(startDate) : startDate;
  if (Number.isNaN(instant.getTime())) return null;

  // No try/catch around `makePartialDate`. Either pair of getters returns a month 1–12 and a
  // day that month really has, so the throw is unreachable — a catch here would be dead code
  // pretending to handle something.
  //
  // The year is always null, and not because it is unknown: `startDate` is the occurrence
  // Android expanded (2027), never the original. `originalStartDate` would carry the real
  // one and is iOS-only. Passing 2027 through would store a person born next year.
  if (encoding === 'utc-midnight') {
    return makePartialDate(instant.getUTCMonth() + 1, instant.getUTCDate(), null);
  }
  return makePartialDate(instant.getMonth() + 1, instant.getDate(), null);
}

/**
 * A calendar day with a known year — the shape an event needs and a `PartialDate` may lack.
 */
export type CalendarDay = { year: number; month: number; day: number };

/**
 * Which midnight a platform's all-day event starts at, as an absolute instant.
 *
 * - `'utc-midnight'` — Android. `CalendarContract` requires an all-day event's `DTSTART` to be
 *   UTC midnight with `EVENT_TIMEZONE` set to UTC; the provider truncates anything else to
 *   the UTC day, which for a local midnight east of Greenwich is the day before.
 * - `'local-midnight'` — iOS. EventKit begins an all-day event at local midnight and reads
 *   the day back in the device's own zone.
 *
 * The same value is the argument to both directions: `partialDateFromAllDayStart` reads with
 * it, `allDayRange` writes with it. The domain cannot know which platform it is on, so the
 * adapters pass it in — chosen from `Platform.OS` in `src/sources/calendar.ts` and
 * `src/export/calendar.ts`, never inside this file.
 */
export type AllDayEncoding = 'utc-midnight' | 'local-midnight';

/**
 * A calendar day → the start and end instants an all-day event for it is written with.
 *
 * Pure. The inverse of `partialDateFromAllDayStart`, and like it, this is encoding rather than
 * arithmetic: the instants are a wire format for one calendar day.
 *
 * The end differs by convention as well as by zone:
 *
 * - Android's `DTEND` is exclusive, so a one-day event ends at the *next* UTC midnight. It
 *   cannot equal the start either — `expo-calendar` derives a recurring event's `DURATION`
 *   from the two, and a zero duration is an event that occupies no day.
 * - EventKit stretches an all-day event over whole days itself, and an end at the next
 *   midnight reads as a second day. So the end is the start. **Unverified on a device** —
 *   there is no iOS build yet.
 *
 * `Date.UTC` and the local `Date` constructor both roll `day + 1` over a month or year end, so
 * 31 December ends on 1 January without a branch here.
 */
export function allDayRange(
  day: CalendarDay,
  encoding: AllDayEncoding,
): { start: Date; end: Date } {
  const { year, month } = day;

  if (encoding === 'utc-midnight') {
    return {
      start: new Date(Date.UTC(year, month - 1, day.day)),
      end: new Date(Date.UTC(year, month - 1, day.day + 1)),
    };
  }

  const start = new Date(year, month - 1, day.day);
  return { start, end: start };
}
