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

  useAskOnce(people.length > 0);
}

/** Module-level, not state: "have we already asked" must survive every re-render and remount. */
let asked = false;

/**
 * Requests notification permission once, the first time there is a birthday to be reminded
 * about.
 *
 * Not on launch. A cold permission dialog on first open — before the app has shown what it
 * is for, and with an empty list behind it — is the version people decline, and on Android a
 * decline is close to final: two dismissals and `canAskAgain` goes false, leaving system
 * settings as the only way back. Waiting until someone has actually saved a birthday means
 * the dialog arrives when the answer is obvious.
 *
 * Deliberately not persisted. `asked` resets on relaunch, but the OS is the real gate: once
 * it has an answer the state stops being `undetermined` and `requestPermission` returns it
 * without showing anything. The flag only stops a second dialog within one session.
 */
function useAskOnce(hasSomeoneToRemindAbout: boolean): void {
  useEffect(() => {
    if (asked || !hasSomeoneToRemindAbout) return;
    asked = true;

    requestPermission().catch((error) => {
      // Retried next launch. The Settings prompt is the manual route in the meantime.
      asked = false;
      console.warn('Could not ask for notification permission', error);
    });
  }, [hasSomeoneToRemindAbout]);
}

/**
 * The notification permission, for the settings screen.
 *
 * Re-read on every foreground because the user can change it in system settings while the
 * app is backgrounded — and after they have been sent there to do exactly that.
 */
export function useNotificationPermission(): {
  /** Null until the OS has answered — callers render nothing rather than guess. */
  permission: PermissionState | null;
  ask: () => Promise<void>;
} {
  // Starts unknown rather than 'undetermined': the first read is a round trip to the OS, and
  // assuming a state means flashing "Allow notifications" at someone who already granted it.
  const [permission, setPermission] = useState<PermissionState | null>(null);
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
