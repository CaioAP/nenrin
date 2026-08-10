/**
 * Settings repository. One row, pinned to id 1.
 *
 * Reads never assume the row exists — a fresh install has run migrations but written
 * nothing — so `getSettings` falls back to `DEFAULT_SETTINGS` rather than returning null and
 * making every caller handle it.
 */

import { eq } from 'drizzle-orm';

import type { AppSettings, SettingsPatch } from '@/domain/settings';
import { db } from './client';
import { toSettings } from './mappers';
import { settings } from './schema';

const SETTINGS_ID = 1;

export async function getSettings(): Promise<AppSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1);
  return toSettings(row);
}

/**
 * Writes a partial update, creating the row on first use.
 *
 * `updatedAt` is not a settable field: the scheduler treats it as evidence that the user
 * changed something, so it is stamped here and nowhere else.
 */
export async function updateSettings(patch: SettingsPatch, now = new Date()): Promise<AppSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch, updatedAt: now };

  await db
    .insert(settings)
    .values({ id: SETTINGS_ID, ...next })
    .onConflictDoUpdate({ target: settings.id, set: next });

  return next;
}
