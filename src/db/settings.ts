/**
 * Settings repository. One row, pinned to id 1.
 *
 * Reads never assume the row exists — a fresh install has run migrations but written
 * nothing — so `getSettings` falls back to `DEFAULT_SETTINGS` rather than returning null and
 * making every caller handle it.
 */

import { eq } from 'drizzle-orm';

import type { LeapDayPolicy } from '@/domain/birthday';
import { type AppSettings, DEFAULT_SETTINGS } from '@/domain/settings';
import { db } from './client';
import { settings } from './schema';

const SETTINGS_ID = 1;

export async function getSettings(): Promise<AppSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1);
  if (!row) return DEFAULT_SETTINGS;

  return {
    defaultLeadDays: row.defaultLeadDays,
    notifyHour: row.notifyHour,
    notifyMinute: row.notifyMinute,
    // The column is a plain TEXT, so a hand-edited database or a future sync could carry
    // anything. Fall back rather than handing an unknown policy to the date maths.
    leapDayPolicy: isLeapDayPolicy(row.leapDayPolicy)
      ? row.leapDayPolicy
      : DEFAULT_SETTINGS.leapDayPolicy,
  };
}

/** Writes a partial update, creating the row on first use. */
export async function updateSettings(
  patch: Partial<AppSettings>,
  now = new Date(),
): Promise<AppSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch };

  await db
    .insert(settings)
    .values({ id: SETTINGS_ID, ...next, updatedAt: now })
    .onConflictDoUpdate({ target: settings.id, set: { ...next, updatedAt: now } });

  return next;
}

function isLeapDayPolicy(value: string): value is LeapDayPolicy {
  return value === 'feb28' || value === 'mar1';
}
