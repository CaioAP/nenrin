/**
 * An all-day event's start → the calendar day it means.
 *
 * Pure. **This is the one place in the codebase where UTC is correct**, and it is worth
 * being precise about why, because AGENTS.md says the opposite everywhere else.
 *
 * Android stores all-day events as UTC midnight: a birthday on 25 January arrives as
 * `2027-01-25T00:00:00.000Z`. That is a *wire format for a calendar day*, not an instant —
 * the event does not begin at a moment, it occupies a date. Reading it back with local
 * getters in São Paulo (UTC−3) yields 24 January, and every date in the app is then off by
 * one for every user west of Greenwich, permanently and silently.
 *
 * So this decodes with UTC getters and hands back three integers. Nothing downstream of here
 * touches UTC: `PartialDate` has no timezone, the birthday renders as the same day
 * everywhere, and the reminder fires on the user's own local morning. This is not
 * arithmetic — it is undoing an encoding.
 *
 * `TZ=Europe/London` cannot check this file. London is UTC+0 in January, so local and UTC
 * agree; in July it is UTC+1, and UTC midnight reads as 01:00 on the *same* day. Both
 * directions are blind. Hence `npm run test:tz`.
 */

import { makePartialDate, type PartialDate } from './birthday';

/** Null when the input is unparseable. */
export function partialDateFromAllDayStart(startDate: string | Date): PartialDate | null {
  const instant = typeof startDate === 'string' ? new Date(startDate) : startDate;
  if (Number.isNaN(instant.getTime())) return null;

  // No try/catch around `makePartialDate`. `getUTCMonth() + 1` is always 1–12 and
  // `getUTCDate()` is always a day that month really has, so the throw is unreachable —
  // a catch here would be dead code pretending to handle something.
  //
  // The year is always null, and not because it is unknown: `startDate` is the occurrence
  // Android expanded (2027), never the original. `originalStartDate` would carry the real
  // one and is iOS-only. Passing 2027 through would store a person born next year.
  return makePartialDate(instant.getUTCMonth() + 1, instant.getUTCDate(), null);
}
