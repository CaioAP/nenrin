/**
 * Bulk sample data, for measuring what only a device can answer.
 *
 * The pending-notification cap is the reason this exists. `armWindow` caps the window at
 * `DEFAULT_NOTIFICATION_LIMIT` precisely because the OS silently drops the overflow, but the
 * real cap is a number nobody has measured on this hardware — and it cannot be measured
 * without more birthdays than anyone wants to type in.
 *
 * Every row is tagged with a `sample:` external id so removal is exact rather than a guess
 * at which people were fake. Called only from the development-only section of Settings; the
 * tagging is what makes that safe to press on a real database.
 */

import { like } from 'drizzle-orm';
import { randomUUID } from 'expo-crypto';

import { db } from './client';
import { toNewPersonRow } from './mappers';
import { person } from './schema';

const SAMPLE_PREFIX = 'sample:';

const FIRST_NAMES = [
  'Ana',
  'Bruno',
  'Carla',
  'Diego',
  'Elena',
  'Felipe',
  'Gabriela',
  'Hugo',
  'Isabel',
  'João',
  'Karina',
  'Lucas',
  'Marina',
  'Nuno',
  'Olivia',
  'Pedro',
  'Rita',
  'Sofia',
  'Tiago',
  'Vera',
];

/**
 * Inserts `count` people spread across the calendar.
 *
 * Spread rather than random: a run that happens to cluster every birthday in December would
 * measure nothing about a cap that only bites when reminders are close together. Stepping
 * through the year by a number coprime with 365 puts one roughly every few days.
 */
export async function addSamplePeople(count = 300, now = new Date()): Promise<number> {
  const rows = Array.from({ length: count }, (_, i) => {
    const dayOfYear = (i * 37) % 365;
    const { month, day } = monthDayFromDayOfYear(dayOfYear);

    return toNewPersonRow(
      {
        displayName: `${FIRST_NAMES[i % FIRST_NAMES.length]} ${i + 1}`,
        birthday: { month, day, year: 1960 + (i % 50) },
        externalId: `${SAMPLE_PREFIX}${i}`,
      },
      randomUUID(),
      now,
    );
  });

  // Chunked: SQLite has a limit on bound parameters per statement, and 300 rows × a dozen
  // columns clears it comfortably.
  for (let i = 0; i < rows.length; i += 50) {
    await db.insert(person).values(rows.slice(i, i + 50));
  }

  return rows.length;
}

/**
 * Removes every sample person. Hard delete, not the soft delete real people get.
 *
 * These rows were never real, so leaving tombstones for a future sync to replicate would be
 * worse than useless.
 */
export async function removeSamplePeople(): Promise<void> {
  await db.delete(person).where(like(person.externalId, `${SAMPLE_PREFIX}%`));
}

/** Uses 2001 — a common year, so day 59 is 1 March and no sample lands on 29 February. */
function monthDayFromDayOfYear(dayOfYear: number): { month: number; day: number } {
  const date = new Date(2001, 0, 1 + dayOfYear);
  return { month: date.getMonth() + 1, day: date.getDate() };
}
