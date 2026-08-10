/**
 * App-wide preferences that shape scheduling.
 *
 * Lives in the domain because `armWindow` needs all of it and none of it is database-shaped.
 * The defaults are here rather than only in the SQLite column definitions, so a caller that
 * has not loaded settings yet still behaves like a correctly configured app.
 */

import { DEFAULT_LEAP_DAY_POLICY, type LeapDayPolicy } from './birthday';

export type AppSettings = {
  /** Days of lead time when neither the person nor any of their groups overrides it. */
  defaultLeadDays: number;
  /** Local time of day reminders fire at. */
  notifyHour: number;
  notifyMinute: number;
  leapDayPolicy: LeapDayPolicy;
  /**
   * When these settings were last changed.
   *
   * Part of the domain rather than a bookkeeping column because the scheduler reads it:
   * lengthening the lead time is one of the two things that legitimately justifies catching
   * up a reminder whose moment has passed. See `Schedulable.knownSince`.
   */
  updatedAt: Date;
};

/** What a user preference is set to before the user has set anything. */
export type SettingsPatch = Partial<Omit<AppSettings, 'updatedAt'>>;

export const DEFAULT_SETTINGS: AppSettings = {
  // 0 means "on the day". A person who has not configured anything gets told on the morning
  // of the birthday, which is the least surprising behaviour for an app they just installed.
  defaultLeadDays: 0,
  notifyHour: 9,
  notifyMinute: 0,
  leapDayPolicy: DEFAULT_LEAP_DAY_POLICY,
  // The epoch, not "now": unconfigured settings have never been changed, and a fresh `new
  // Date()` here would read as a change on every launch and catch up reminders that had
  // already fired.
  updatedAt: new Date(0),
};

export const LEAD_DAY_CHOICES = [0, 1, 3, 7] as const;

/**
 * The times a reminder may fire at.
 *
 * A fixed set rather than a time picker. The only question worth asking is roughly when in
 * the day you want to be told, and a picker trades a one-tap answer for a scroll wheel and
 * a platform-specific modal — for a preference almost nobody revisits.
 */
export const NOTIFY_TIME_CHOICES = [7, 8, 9, 12, 18, 20] as const;

/** Label for a lead time, for settings and per-person overrides. */
export function describeLeadDays(days: number): string {
  if (days === 0) return 'On the day';
  if (days === 1) return '1 day before';
  if (days === 7) return '1 week before';
  return `${days} days before`;
}

/** "09:00". 24-hour, because the app is English-only and the label must not wrap on a chip. */
export function formatTimeOfDay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Label for a leap-day policy, phrased as what actually happens rather than as the token. */
export function describeLeapDayPolicy(policy: LeapDayPolicy): string {
  return policy === 'feb28' ? '28 February' : '1 March';
}
