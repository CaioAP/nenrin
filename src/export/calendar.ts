/**
 * The device calendar as somewhere to write birthdays.
 *
 * Thin, in the shape `src/sources/calendar.ts` established for reading: which events, on which
 * day, under which title, is decided in `src/domain/calendar-export.ts`, and how a day becomes
 * an instant is `allDayRange` in `src/domain/calendar-date.ts`. What is left here is the
 * platform fork and the SDK calls, verified on a device rather than in Vitest.
 *
 * **Nenrin writes into a calendar of its own, never the user's.** Removing everything Nenrin
 * added is then one calendar deletion rather than a hunt through the user's own events, and a
 * user who wants birthdays out of their day view can hide one calendar.
 *
 * A static import, like the reading adapter: `expo-calendar` swaps in a stub under Expo Go
 * whose calls throw, so the import itself is safe there.
 */

import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

import { type AllDayEncoding, allDayRange } from '@/domain/calendar-date';
import type { ExportEvent } from '@/domain/calendar-export';

/** What the user sees in their calendar app's list. */
export const EXPORT_CALENDAR_TITLE = 'Nenrin birthdays';

/**
 * Android's `Calendars.NAME`, which no calendar app lets the user edit — unlike the title.
 * It is what identifies the calendar as Nenrin's from the reading side; see `isExportCalendar`.
 */
const EXPORT_CALENDAR_NAME = 'nenrin_birthdays';

/** The local account the Android calendar belongs to. Not synced anywhere, by design. */
const ANDROID_ACCOUNT = 'Nenrin';

/** The app's brand colour, matching the notification accent in `app.json`. */
const EXPORT_CALENDAR_COLOR = '#244f7c';

/**
 * Which midnight an all-day event starts at here. See `AllDayEncoding` for why they differ.
 *
 * Decided at the adapter boundary, as `src/domain/` must not know which platform it runs on.
 * Exported because the importer in `src/sources/calendar.ts` decodes with the same value —
 * one platform fork, read and written from one place.
 */
export const allDayEncoding: AllDayEncoding =
  Platform.OS === 'android' ? 'utc-midnight' : 'local-midnight';

/**
 * Whether a calendar is the one this module created, so the importer can skip it.
 *
 * Without this, turning export on and then importing from calendars would read Nenrin's own
 * events back as candidates. The identity-key match in `partitionCandidates` would catch most
 * of them as people already saved, but only while the name still parses back unchanged — so
 * the importer is told plainly instead.
 *
 * Android matches on `name`, which no calendar app exposes for editing. iOS has no such field,
 * so it matches on the title, which the user can rename — an accepted gap until there is an
 * iOS build to look at, and the identity-key match still stands behind it.
 */
export function isExportCalendar(calendar: { name?: string | null; title: string }): boolean {
  return Platform.OS === 'android'
    ? calendar.name === EXPORT_CALENDAR_NAME
    : calendar.title === EXPORT_CALENDAR_TITLE;
}

/** Asks for calendar access if it has not been answered yet. True when writing is allowed. */
export async function requestExportAccess(): Promise<boolean> {
  return (await Calendar.requestCalendarPermissions()).granted;
}

/** The same question without a prompt, for background syncs. */
export async function hasExportAccess(): Promise<boolean> {
  return (await Calendar.getCalendarPermissions()).granted;
}

/**
 * Looked up in the full list rather than with `ExpoCalendar.get`, so "it is gone" is an
 * ordinary `undefined` instead of a rejection that looks the same as a permission failure.
 *
 * The list includes hidden calendars: unlike event queries, `getCalendars` has no `VISIBLE`
 * filter on Android. So a user hiding Nenrin's calendar does not read here as deleting it.
 */
async function findCalendar(id: string): Promise<Calendar.ExpoCalendar | undefined> {
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  return calendars.find((calendar) => calendar.id === id);
}

export async function calendarExists(id: string): Promise<boolean> {
  return (await findCalendar(id)) !== undefined;
}

/**
 * Creates Nenrin's calendar and returns its id.
 *
 * Android needs an owning account. A local one keeps the calendar on the device, matching an
 * app that sends nothing anywhere, and `CalendarContract` would delete a calendar claiming a
 * synced account that does not exist. iOS puts it in the default calendar's source — iCloud,
 * if the user has it — and needs nothing else.
 */
export async function createExportCalendar(): Promise<string> {
  const calendar = await Calendar.createCalendar(
    Platform.OS === 'android'
      ? {
          title: EXPORT_CALENDAR_TITLE,
          name: EXPORT_CALENDAR_NAME,
          color: EXPORT_CALENDAR_COLOR,
          source: { isLocalAccount: true, name: ANDROID_ACCOUNT, type: 'LOCAL' },
          ownerAccount: ANDROID_ACCOUNT,
          accessLevel: Calendar.CalendarAccessLevel.OWNER,
        }
      : {
          title: EXPORT_CALENDAR_TITLE,
          color: EXPORT_CALENDAR_COLOR,
          entityType: Calendar.EntityTypes.EVENT,
        },
  );
  return calendar.id;
}

/** Deletes Nenrin's calendar, and every event in it with it. A missing calendar is a no-op. */
export async function deleteExportCalendar(id: string): Promise<void> {
  const calendar = await findCalendar(id);
  if (calendar) await calendar.delete();
}

/**
 * Writes one event and returns its id.
 *
 * - `timeZone: 'UTC'` on Android is half of the all-day contract there: `expo-calendar`
 *   otherwise stamps the device zone onto the event, and the provider expects UTC for an
 *   all-day row. On iOS an all-day event carries no zone at all.
 * - `alarms: []`, so neither platform adds a default alert. Nenrin sends its own reminder;
 *   a second one from the calendar would be the same news twice.
 */
export async function createExportEvent(calendarId: string, event: ExportEvent): Promise<string> {
  const calendar = await findCalendar(calendarId);
  if (!calendar) throw new Error('Nenrin’s calendar is gone.');

  const { start, end } = allDayRange(event.day, allDayEncoding);
  const created = await calendar.createEvent({
    title: event.title,
    notes: event.notes,
    startDate: start,
    endDate: end,
    allDay: true,
    ...(Platform.OS === 'android' ? { timeZone: 'UTC' } : {}),
    alarms: [],
    recurrenceRule:
      event.recurrence === 'yearly' ? { frequency: Calendar.Frequency.YEARLY } : undefined,
  });
  return created.id;
}

/**
 * Deletes one event — the whole series, for a yearly one. An event already gone is a no-op:
 * the user may have deleted it by hand, and the goal state is the same.
 *
 * `getOccurrenceSync({ futureEvents: true })` is what makes "the whole series" true on iOS.
 * `ExpoCalendarEvent.get` hands back the first occurrence with the span `.thisEvent`, and
 * deleting that removes one birthday and leaves every later year standing. From the first
 * occurrence, `.futureEvents` is all of them. On Android the same call returns the event
 * unchanged and deletes the master row, which already takes every instance with it.
 */
export async function deleteExportEvent(eventId: string): Promise<void> {
  let event: Calendar.ExpoCalendarEvent;
  try {
    event = await Calendar.ExpoCalendarEvent.get(eventId);
  } catch {
    return;
  }
  await event.getOccurrenceSync({ futureEvents: true }).delete();
}
