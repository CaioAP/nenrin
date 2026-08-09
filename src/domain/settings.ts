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
};

export const DEFAULT_SETTINGS: AppSettings = {
  // 0 means "on the day". A person who has not configured anything gets told on the morning
  // of the birthday, which is the least surprising behaviour for an app they just installed.
  defaultLeadDays: 0,
  notifyHour: 9,
  notifyMinute: 0,
  leapDayPolicy: DEFAULT_LEAP_DAY_POLICY,
};

export const LEAD_DAY_CHOICES = [0, 1, 3, 7] as const;

/** Label for a lead time, for settings and per-person overrides. */
export function describeLeadDays(days: number): string {
  if (days === 0) return 'On the day';
  if (days === 1) return '1 day before';
  if (days === 7) return '1 week before';
  return `${days} days before`;
}
