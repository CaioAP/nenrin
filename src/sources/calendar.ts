/**
 * The device's calendars as a birthday source.
 *
 * Thin, in the shape `contacts.ts` established: everything that can be wrong — the name
 * inside a title, the UTC-midnight wire format — lives in `src/domain/calendar-title.ts` and
 * `src/domain/calendar-date.ts`, which are pure and tested. What is left here is a sequence
 * of SDK calls with no branching of its own, which is why there is no test file.
 *
 * **A module-scope import is safe here, unlike `expo-notifications`.** `expo-calendar`
 * resolves `CalendarNext` at import and substitutes `ExpoGoCalendarNextStub` under Expo Go,
 * so the import survives and only the calls throw. A dev build is required either way.
 */

import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

import { partialDateFromAllDayStart } from '@/domain/calendar-date';
import { parseBirthdayTitle } from '@/domain/calendar-title';
import type { ImportCandidate } from '@/domain/import';
import type { AccessLevel, BirthdaySource } from './types';

/**
 * How far forward to read, in days.
 *
 * One year exactly. A yearly birthday falls inside that window once; a longer one returns
 * the same person twice under one `id`, and the second copy would look like a duplicate the
 * user has to skip.
 */
const WINDOW_DAYS = 365;

const MS_PER_DAY = 86_400_000;

export const calendarSource: BirthdaySource = {
  id: 'calendar',

  async isAvailable() {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  },

  /**
   * No limited-access concept here. `'limited'` is an iOS 18 *contacts* idea — the calendar
   * permission is granted or it is not.
   */
  async requestAccess(): Promise<AccessLevel> {
    const permission = await Calendar.requestCalendarPermissions();
    return permission.granted ? 'all' : 'none';
  },

  async fetchCandidates(): Promise<ImportCandidate[]> {
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    if (calendars.length === 0) return [];

    // Every calendar, not a birthdays calendar. Birthday events live in the user's primary
    // calendar; Google Calendar's "Birthdays" heading corresponds to no row in
    // `CalendarContract`, and Samsung's real `local.samsungbirthday` calendar is empty.
    // Matching on calendar identity finds none of them.
    //
    // Calendars the user has hidden are absent from this result whatever we pass —
    // `expo-calendar` hardcodes `Instances.VISIBLE = 1` into the query. See
    // `hiddenCalendarTitles`, which is how the screen tells the user that happened.
    const from = new Date();
    const to = new Date(from.getTime() + WINDOW_DAYS * MS_PER_DAY);
    const events = await Calendar.listEvents(
      calendars.map((calendar) => calendar.id),
      from,
      to,
    );

    return events.flatMap(toCandidate);
  },
};

/**
 * `flatMap` rather than `map` + `filter`, so the two "not a birthday" answers and the
 * successful one are one expression each and nothing needs a non-null assertion after.
 */
function toCandidate(event: Calendar.ExpoCalendarEvent): ImportCandidate[] {
  // All-day only. `partialDateFromAllDayStart` is named for its precondition: UTC getters
  // are correct *because* the platform encodes an all-day date as UTC midnight. A timed
  // 21:00 event in São Paulo is 00:00 UTC the following day, so decoding one that way
  // would land the birthday on the wrong date — and a titled "Ana's birthday" dinner
  // booking is exactly the kind of event a user really has.
  if (!event.allDay) return [];

  const parsed = parseBirthdayTitle(event.title);
  if (!parsed) return [];

  const birthday = partialDateFromAllDayStart(event.startDate);
  if (!birthday) return [];

  return [
    {
      // `event.id`, not `instanceId`. `id` is the provider's master row, verified on a
      // device to survive a 180-day window shift; `instanceId` is Android-only, differs per
      // occurrence, and is documented as "volatile ... not guaranteed to always refer to the
      // same instance". `externalId` is the whole de-duplication contract, so an id that
      // changed between reads would re-deal the same person on every scan, silently.
      externalId: event.id,
      displayName: parsed.displayName,
      birthday,
      source: 'calendar',
    },
  ];
}

/**
 * Titles of calendars the query cannot read. Empty when nothing is hidden.
 *
 * `expo-calendar` hardcodes `CalendarContract.Instances.VISIBLE = 1` into its selection on
 * Android — `InstanceRepository.buildSelection` in the next API, `buildSelectionForEventsQuery`
 * in the legacy one, neither with an opt-out. `VISIBLE` is a column on the *calendar*, not
 * the event, so a hidden calendar returns zero events and looks exactly like an empty one.
 *
 * Worse, the column belongs to whichever app manages calendars on the device. On the Samsung
 * test phone that is Samsung Calendar, not Google Calendar: the calendars read as ticked
 * inside Google Calendar the whole time while the provider had them hidden. So a user can
 * have a calendar switched on, look at its events every day, and have it be unreadable here.
 *
 * The app cannot fix it — `isVisible` is read-only from JavaScript, because
 * `ModifiableCalendarProperties` is `Pick<ExpoCalendar, 'color' | 'title'>` even though
 * Kotlin's `CalendarUpdateRecord` accepts it. All the screen can do is say which ones.
 *
 * Kept off `BirthdaySource` deliberately: no other source has this problem, and widening a
 * four-method interface for one platform's quirk would make every future source implement it.
 *
 * Returns empty on a denied permission rather than throwing. With no access there are no
 * calendars to report as hidden, and the screen is already showing a denial message — a
 * second warning underneath it would be noise about a problem the user cannot act on yet.
 */
export async function hiddenCalendarTitles(): Promise<string[]> {
  const permission = await Calendar.getCalendarPermissions();
  if (!permission.granted) return [];

  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  // `=== false`, not `!isVisible`. The field is `isVisible?: boolean` and is undefined where
  // the platform does not report it — which means "unknown", not "hidden".
  return calendars
    .filter((calendar) => calendar.isVisible === false)
    .map((calendar) => calendar.title);
}
