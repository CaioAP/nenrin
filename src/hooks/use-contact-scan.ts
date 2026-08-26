/**
 * One scan of the address book, shared by the import screen and the debug panel.
 *
 * The sequence — request access, fetch, read both handled sets, partition — was written
 * once in the debug panel and is now needed for real. Two copies would drift, and the one
 * that drifted would be the one nobody was watching.
 */

import { useCallback, useEffect, useState } from 'react';

import { listExternalIdsBySource } from '@/db/people';
import { listSkippedExternalIds } from '@/db/skipped';
import { type Partitioned, partitionCandidates } from '@/domain/import';
import { contactsSource } from '@/sources/contacts';
import type { AccessLevel } from '@/sources/types';

export type ScanResult = {
  access: AccessLevel;
  partitioned: Partitioned;
};

const NOTHING: Partitioned = { ready: [], needsBirthday: [], alreadyKnown: [] };

/**
 * Runs the whole read path once.
 *
 * Access denied returns empty buckets rather than throwing. The app must stay fully usable
 * with contacts refused, so "no" is an ordinary answer here, not an error.
 */
export async function scanContacts(): Promise<ScanResult> {
  const access = await contactsSource.requestAccess();
  if (access === 'none') return { access, partitioned: NOTHING };

  const candidates = await contactsSource.fetchCandidates();
  const [imported, skipped] = await Promise.all([
    listExternalIdsBySource('contacts'),
    listSkippedExternalIds('contacts'),
  ]);

  return { access, partitioned: partitionCandidates(candidates, { imported, skipped }) };
}

export type ContactScan =
  | { state: 'scanning' }
  | { state: 'ready'; result: ScanResult }
  | { state: 'failed'; error: Error };

/**
 * The same scan as a screen state machine.
 *
 * `rescan` exists because both screens change what the scan would return — importing the
 * ready bucket, or handling a card — and a stale count on screen is worse than a spinner.
 */
export function useContactScan(): { scan: ContactScan; rescan: () => void } {
  const [scan, setScan] = useState<ContactScan>({ state: 'scanning' });
  const [nonce, setNonce] = useState(0);

  // `nonce` is not read in the body — it exists only so `rescan` can force this effect to
  // run again, which is exactly what the exhaustive-deps rule cannot see.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a rescan trigger, not a data dependency
  useEffect(() => {
    let cancelled = false;
    setScan({ state: 'scanning' });

    scanContacts()
      .then((result) => {
        if (!cancelled) setScan({ state: 'ready', result });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setScan({
            state: 'failed',
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });

    // Guards against a scan of four hundred contacts resolving after the screen is gone.
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const rescan = useCallback(() => setNonce((n) => n + 1), []);

  return { scan, rescan };
}
