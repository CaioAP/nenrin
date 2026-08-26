/**
 * The contacts the triage deck should not ask about, and why.
 *
 * Keyed on source and external id rather than on a person, because the whole point is that
 * no person row exists — see the table's own comment in `schema.ts`. Without this, every
 * re-import replays the entire address book.
 */

import { and, count, eq } from 'drizzle-orm';

import type { SkipKind } from '@/domain/import';
import type { PersonSource } from '@/domain/person';
import { db } from './client';
import { skipped } from './schema';

/**
 * Every external id from this source the deck should pass over — both kinds.
 *
 * Deliberately does not distinguish them. A deferred candidate and a refused one are equally
 * "not in the deck right now"; only `clearDeferred` cares which is which.
 */
export async function listSkippedExternalIds(source: PersonSource): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: skipped.externalId })
    .from(skipped)
    .where(eq(skipped.source, source));

  return new Set(rows.map((row) => row.externalId));
}

/**
 * Records a skip or a refusal. Idempotent — the primary key is the source/id pair, so
 * skipping something already skipped is not an error.
 *
 * `onConflictDoUpdate` rather than `DoNothing`: refusing a contact previously deferred must
 * upgrade the row, or "don't ask again" would silently do nothing the second time round.
 */
export async function skipContact(
  source: PersonSource,
  externalId: string,
  kind: SkipKind,
): Promise<void> {
  await db
    .insert(skipped)
    .values({ source, externalId, kind })
    .onConflictDoUpdate({
      target: [skipped.source, skipped.externalId],
      set: { kind },
    });
}

/** How many candidates are merely deferred, for the "ask me again" offer. */
export async function countDeferred(source: PersonSource): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(skipped)
    .where(and(eq(skipped.source, source), eq(skipped.kind, 'deferred')));

  return row?.total ?? 0;
}

/**
 * Puts every deferred candidate back in the deck. Refusals are untouched — that is the
 * whole distinction, and the only thing in the app that acts on it.
 */
export async function clearDeferred(source: PersonSource): Promise<number> {
  const deleted = await db
    .delete(skipped)
    .where(and(eq(skipped.source, source), eq(skipped.kind, 'deferred')))
    .returning({ externalId: skipped.externalId });

  return deleted.length;
}
