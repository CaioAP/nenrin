/**
 * Re-syncs Nenrin's calendar whenever what it should contain might have changed.
 *
 * Mounted once, at the root, beside `useReminders` and for the same reason: the calendar is
 * derived state, and a screen that had to remember to re-export after every write would be
 * the screen that forgot.
 */

import { useEffect } from 'react';

import { useCalendarExport, usePeople, useSettings } from '@/db/hooks';
import { useForegroundTime } from '@/hooks/use-foreground-time';
import { syncCalendarExport } from './sync';

export function useCalendarExportSync(): void {
  const { people } = usePeople();
  const { settings } = useSettings();
  const { state } = useCalendarExport();
  const foregroundAt = useForegroundTime();

  // Every dependency is a signal, not a value read here — `syncCalendarExport` reads its own
  // inputs from the database, so it never works from a render's stale copy.
  //
  // `foregroundAt` covers two things nothing else would: a new year sliding the 29 February
  // events forward, and a calendar the user deleted while the app was in the background.
  // Not `exportedCount`: the sync writes it, so depending on it would re-run the sync after
  // every sync.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync on every signal above
  useEffect(() => {
    if (!state.enabled) return;

    syncCalendarExport().catch((error) => {
      // Nothing to show here: this runs unprompted, and the next write or foreground retries.
      // The settings screen reports failures from the syncs a person asked for.
      console.warn('Could not update the birthday calendar', error);
    });
  }, [people, settings.leapDayPolicy, state.enabled, foregroundAt]);
}
