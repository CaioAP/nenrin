/**
 * Decides *which* birthdays get a pending local notification and *when* each one fires.
 *
 * The whole file exists because of one platform constraint: the OS caps how many local
 * notifications an app may have pending (iOS is commonly cited at 64, and the real number
 * is measured on device — see the plan). Scheduling one per person looks fine with a
 * handful of test contacts and then silently stops working for anyone with a real address
 * book, because the OS drops the overflow without an error.
 *
 * So we never schedule the whole list. We arm a *window* of the soonest reminders and
 * re-arm it whenever the app comes to the foreground. Pure functions, no Expo imports —
 * `src/notifications` does the actual scheduling with whatever this returns.
 */

import {
  ageAtNextOccurrence,
  DEFAULT_LEAP_DAY_POLICY,
  type LeapDayPolicy,
  nextOccurrence,
  type PartialDate,
  startOfDay,
} from './birthday';

/**
 * Kept deliberately below the commonly-cited iOS cap of 64: other parts of the app may want
 * pending notifications too, and a window this size already covers months of birthdays for a
 * typical list. Confirm the true cap on a device before raising it.
 */
export const DEFAULT_NOTIFICATION_LIMIT = 40;

/** The minimum a person must carry to be schedulable — deliberately not the full DB row. */
export type Schedulable = {
  id: string;
  displayName: string;
  birthday: PartialDate;
  /** How many days early to fire. 0 means on the day. */
  leadDays: number;
  /** Muted people stay in the list and out of the notification window. */
  muted?: boolean;
  /**
   * When this person's reminder schedule last changed — the later of their own row and the
   * app's reminder settings.
   *
   * The catch-up branch below needs to tell "this reminder's moment passed before we ever
   * knew about it" from "this reminder's moment passed and it therefore already fired".
   * Nothing else can: a delivered local notification is invisible to an app that was closed
   * when it arrived, so the app can never record what actually went out. What it *can* know
   * is whether a reminder could have been armed in time.
   */
  knownSince: Date;
};

export type Reminder = {
  personId: string;
  displayName: string;
  /** When to fire the notification. */
  fireAt: Date;
  /** The calendar day being celebrated. */
  occursOn: Date;
  /** Age they are turning, or null when the birth year is unknown. */
  turningAge: number | null;
};

export type ArmWindowOptions = {
  /** "Now". Injected rather than read from the clock so this stays testable. */
  from: Date;
  /** Local time of day the notification should fire at. */
  timeOfDay: { hour: number; minute: number };
  /** Maximum pending notifications to arm. */
  limit?: number;
  policy?: LeapDayPolicy;
};

const atTimeOfDay = (day: Date, { hour, minute }: { hour: number; minute: number }) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/**
 * Where a reminder fires: `leadDays` before the birthday, at the configured time of day.
 * Returns null when there is no longer a useful moment left to fire at.
 *
 * If the ideal moment has already passed — the user set a week's lead time and the birthday
 * is in three days — we do *not* push the reminder to next year. Missing a birthday that is
 * still ahead is the worst outcome available, so it fires at the next time-of-day slot
 * instead, clamped so it never lands after the birthday itself.
 *
 * **That catch-up only applies to a reminder that could not already have been sent.** The
 * window is re-armed on every foreground, so without the `knownSince` guard a lead time of
 * a week produces a fresh reminder every single day: the ideal moment sits in the past, the
 * catch-up rolls it to tomorrow, it fires, and tomorrow it happens again. The guard limits
 * catch-up to the case it was written for — a person just added, or a lead time just
 * lengthened, where no reminder was ever armed for the moment that passed.
 *
 * The clamp is what makes the other null case possible. When the birthday is *today* and
 * today's slot has gone, the only candidate left is in the past. Scheduling into the past is
 * never right: the OS either fires it instantly or discards it, and today's reminder has
 * already been delivered anyway, so firing again is a duplicate. The caller drops it and the
 * Upcoming list carries the day.
 *
 * Every non-null return is strictly later than `from`. `src/notifications` relies on it.
 */
function fireTimeFor(person: Schedulable, occursOn: Date, options: ArmWindowOptions): Date | null {
  const { from, timeOfDay } = options;
  const ideal = atTimeOfDay(addDays(occursOn, -person.leadDays), timeOfDay);
  if (ideal.getTime() > from.getTime()) return ideal;

  // Known before the moment passed, so a reminder was armed for it and has been delivered.
  if (person.knownSince.getTime() <= ideal.getTime()) return null;

  const todaySlot = atTimeOfDay(from, timeOfDay);
  const nextSlot =
    todaySlot.getTime() > from.getTime() ? todaySlot : atTimeOfDay(addDays(from, 1), timeOfDay);
  const onTheDay = atTimeOfDay(occursOn, timeOfDay);

  const candidate = nextSlot.getTime() < onTheDay.getTime() ? nextSlot : onTheDay;
  return candidate.getTime() > from.getTime() ? candidate : null;
}

/**
 * The soonest `limit` reminders, ascending by fire time.
 *
 * Call this on every foreground and after any write, cancel everything currently pending,
 * and schedule exactly what comes back.
 */
export function armWindow(people: Schedulable[], options: ArmWindowOptions): Reminder[] {
  const { from, limit = DEFAULT_NOTIFICATION_LIMIT, policy = DEFAULT_LEAP_DAY_POLICY } = options;
  const today = startOfDay(from);

  return people
    .filter((person) => !person.muted)
    .flatMap((person) => {
      const occursOn = nextOccurrence(person.birthday, today, policy);
      const fireAt = fireTimeFor(person, occursOn, options);
      // Dropped here rather than after the slice, so a reminder with nothing useful left to
      // fire at never occupies one of the scarce pending-notification slots.
      if (fireAt === null) return [];

      return [
        {
          personId: person.id,
          displayName: person.displayName,
          occursOn,
          fireAt,
          turningAge: ageAtNextOccurrence(person.birthday, today, policy),
        },
      ];
    })
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, limit);
}
