/**
 * Keeps the OS's pending notifications in step with the database.
 *
 * Mounted once, at the root. There is no "reschedule" button anywhere in the app and there
 * should not be: the window is derived state, and anything that can change it — adding a
 * person, editing a birthday, changing the lead time, or simply time passing — re-runs this.
 */

import { useEffect, useState } from 'react';

import { usePeople, useSettings } from '@/db/hooks';
import { listSchedulable } from '@/db/people';
import { armWindow } from '@/domain/schedule';
import { useForegroundTime } from '@/hooks/use-foreground-time';
import { getPermission, type PermissionState, requestPermission, syncReminders } from './reminders';

/**
 * Re-arms the notification window whenever the data, the settings, or the day change.
 *
 * `usePeople` is read for its reactivity, not its rows: it re-runs this effect on any write,
 * while `listSchedulable` does the actual read. That split exists because lead times resolve
 * through group membership, which is a join `usePeople` does not do — and reimplementing the
 * fallback here would give notifications a second, quietly different answer to "how early?".
 */
export function useReminders(): void {
  const { people } = usePeople();
  const { settings } = useSettings();
  const foregroundAt = useForegroundTime();

  // `foregroundAt` is a signal here, not a value: `armWindow` must be given the true current
  // time, because it decides whether a reminder's moment has already passed. Handing it a
  // timestamp minutes old can produce a `fireAt` in the past, which the OS delivers
  // instantly — a duplicate notification for a birthday already announced.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-arm on every foreground
  useEffect(() => {
    listSchedulable(settings)
      .then((schedulable) =>
        syncReminders(
          armWindow(schedulable, {
            from: new Date(),
            timeOfDay: { hour: settings.notifyHour, minute: settings.notifyMinute },
            policy: settings.leapDayPolicy,
          }),
        ),
      )
      // Not cancelled on unmount: `syncReminders` serialises internally, so an in-flight run
      // finishes rather than leaving the window half-armed, and this hook only unmounts when
      // the app is going away.
      .catch((error) => {
        // Nothing actionable for the user: the Upcoming list still shows every birthday, and
        // the next foreground retries. Failing loudly here would mean an alert on launch for
        // a problem they cannot fix.
        console.warn('Could not arm birthday reminders', error);
      });
  }, [people, settings, foregroundAt]);
}

/**
 * The notification permission, for the settings screen.
 *
 * Re-read on every foreground because the user can change it in system settings while the
 * app is backgrounded — and after they have been sent there to do exactly that.
 */
export function useNotificationPermission(): {
  permission: PermissionState;
  ask: () => Promise<void>;
} {
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const foregroundAt = useForegroundTime();

  // Another signal-only dependency: the answer comes from the OS, so nothing in React state
  // changes when the user flips the switch in system settings and comes back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read on every foreground
  useEffect(() => {
    let cancelled = false;
    getPermission().then((state) => {
      if (!cancelled) setPermission(state);
    });
    return () => {
      cancelled = true;
    };
  }, [foregroundAt]);

  return {
    permission,
    ask: async () => {
      setPermission(await requestPermission());
    },
  };
}
