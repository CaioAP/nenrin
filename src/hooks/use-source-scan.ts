/**
 * One scan of one source, shared by the import screen, the triage deck and the debug panel.
 *
 * The sequence — request access, fetch, read both handled sets, partition — is identical for
 * every source, which is why this takes a `BirthdaySource` rather than existing twice. Two
 * copies would drift, and the one that drifted would be the one nobody was watching.
 */

import { useCallback, useEffect, useState } from 'react';

import { listExternalIdsBySource } from '@/db/people';
import { listSkippedExternalIds } from '@/db/skipped';
import { type Partitioned, partitionCandidates } from '@/domain/import';
import type { AccessLevel, BirthdaySource } from '@/sources/types';

export type ScanResult = {
  access: AccessLevel;
  partitioned: Partitioned;
};

/**
 * Fresh buckets per call rather than a shared constant.
 *
 * A module-level object would hand the same three array instances to every denied scan, so
 * one consumer sorting or pushing in place would corrupt every other consumer's view. The
 * aliasing is invisible at the call site, which is exactly why it should not exist.
 */
function nothingFound(): Partitioned {
  return { ready: [], needsBirthday: [], alreadyKnown: [] };
}

/**
 * Runs the whole read path once, for one source.
 *
 * **Both database reads key off `source.id`.** They were hardcoded to `'contacts'` when
 * there was one source; leaving them would partition calendar candidates against the
 * contacts sets, so every calendar person would look new forever and nothing the user
 * skipped would stay skipped. It typechecks perfectly.
 *
 * Access denied returns empty buckets rather than throwing. The app must stay fully usable
 * with a source refused, so "no" is an ordinary answer here, not an error.
 */
export async function scanSource(source: BirthdaySource): Promise<ScanResult> {
  const access = await source.requestAccess();
  if (access === 'none') return { access, partitioned: nothingFound() };

  const candidates = await source.fetchCandidates();
  const [imported, skipped] = await Promise.all([
    listExternalIdsBySource(source.id),
    listSkippedExternalIds(source.id),
  ]);

  return { access, partitioned: partitionCandidates(candidates, { imported, skipped }) };
}

export type SourceScan =
  | { state: 'scanning' }
  | { state: 'ready'; result: ScanResult }
  | { state: 'failed'; error: Error };

/**
 * Whatever was thrown, as an Error worth showing someone.
 *
 * `String(value)` on a rejection shaped `{ code, message }` — which is what an RN bridge
 * call, expo-contacts, expo-calendar or expo-sqlite actually produces — yields
 * "[object Object]", and the import screen puts `error.message` on screen verbatim. So the
 * one case that most needs its message preserved is exactly the one a bare `String()` throws
 * away.
 */
function asError(value: unknown): Error {
  if (value instanceof Error) return value;

  if (typeof value === 'object' && value !== null && 'message' in value) {
    return new Error(String((value as { message: unknown }).message));
  }

  return new Error(String(value));
}

/**
 * The same scan as a screen state machine.
 *
 * `rescan` exists because both screens change what the scan would return — importing the
 * ready bucket, or handling a card — and a stale count on screen is worse than a spinner.
 *
 * `source` belongs in the dependency list because it really is one: every adapter is a
 * module-level constant, so the identity is stable, and a screen that switches sources gets
 * a fresh scan rather than the previous source's buckets.
 */
export function useSourceScan(source: BirthdaySource): { scan: SourceScan; rescan: () => void } {
  const [scan, setScan] = useState<SourceScan>({ state: 'scanning' });
  const [nonce, setNonce] = useState(0);

  // `nonce` is not read in the body — it exists only so `rescan` can force this effect to
  // run again, which is exactly what the exhaustive-deps rule cannot see.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a rescan trigger, not a data dependency
  useEffect(() => {
    let cancelled = false;
    setScan({ state: 'scanning' });

    scanSource(source)
      .then((result) => {
        if (!cancelled) setScan({ state: 'ready', result });
      })
      .catch((error: unknown) => {
        if (!cancelled) setScan({ state: 'failed', error: asError(error) });
      });

    // Guards against a scan of four hundred contacts resolving after the screen is gone.
    return () => {
      cancelled = true;
    };
  }, [source, nonce]);

  const rescan = useCallback(() => setNonce((n) => n + 1), []);

  return { scan, rescan };
}
