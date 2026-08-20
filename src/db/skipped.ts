/**
 * The contacts the user refused, so the triage deck never asks about them twice.
 *
 * Keyed on source and external id rather than on a person, because the whole point is that
 * no person row exists — see the table's own comment in `schema.ts`. Without this, every
 * re-import replays the entire address book.
 */

import { eq } from 'drizzle-orm';

import type { PersonSource } from '@/domain/person';
import { db } from './client';
import { skipped } from './schema';

/** Every external id from this source that the user has told us to stop asking about. */
export async function listSkippedExternalIds(source: PersonSource): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: skipped.externalId })
    .from(skipped)
    .where(eq(skipped.source, source));

  return new Set(rows.map((row) => row.externalId));
}

/**
 * Records a refusal. Idempotent — tapping "don't ask again" on a contact already refused is
 * not an error, and the primary key is the source/id pair.
 */
export async function skipContact(source: PersonSource, externalId: string): Promise<void> {
  await db.insert(skipped).values({ source, externalId }).onConflictDoNothing();
}
