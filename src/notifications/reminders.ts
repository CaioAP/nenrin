/**
 * The Expo side of reminders. Everything that decides *what* to schedule lives in
 * `src/domain/schedule.ts`; this file only talks to the OS.
 *
 * **One-shot DATE triggers, not YEARLY.** A recurring yearly trigger cannot express what
 * `armWindow` produces — lead time shifts a reminder off the birthday, a lead time longer
 * than the remaining days clamps it to the next slot, and a reminder with nothing useful
 * left to fire at is dropped entirely. None of that survives being flattened to a repeating
 * month/day. So we schedule concrete dates and re-arm the window whenever the data or the
 * app's foreground state changes.
 *
 * The cost of that choice is a horizon: only the soonest `DEFAULT_NOTIFICATION_LIMIT`
 * birthdays are pending at any moment, and nothing re-arms them while the app is closed. A
 * user who never opens Nenrin eventually drains the window. Covering that needs a background
 * task, which is deliberately not in v1 — see AGENTS.md.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { reminderCopy } from '@/domain/reminder-copy';
import type { Reminder } from '@/domain/schedule';

/**
 * Android requires a channel before anything can be posted, and one created lazily at
 * schedule time shows up in system settings with a generic name. Naming it means the user
 * can silence birthday reminders without silencing the app.
 */
const CHANNEL_ID = 'birthdays';

/** Marks our notifications so a cancel-all never reaches a notification we did not post. */
const REMINDER_DATA = { kind: 'birthday-reminder' } as const;

let configuring: Promise<void> | null = null;

/**
 * Idempotent one-time setup. Safe to call on every mount.
 *
 * The handler decides what happens when a reminder arrives while the app is open. Without
 * it, a foreground notification is delivered silently and the user sees nothing — which
 * looks exactly like a scheduling bug and is the usual cause of "it didn't fire".
 *
 * The *promise* is cached rather than a done flag: a flag set before the channel is created
 * lets a second caller sail past and schedule into a channel that does not exist yet.
 */
export function configureNotifications(): Promise<void> {
  configuring ??= (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Birthdays',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
  })().catch((error) => {
    // Not cached as a permanent failure: the next sync retries rather than leaving the app
    // unable to configure itself for the rest of the session.
    configuring = null;
    throw error;
  });

  return configuring;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

function toState(response: Notifications.NotificationPermissionsStatus): PermissionState {
  if (response.granted) return 'granted';
  // `canAskAgain` distinguishes "not asked yet" from "said no". Only the latter needs the
  // settings-app detour, and telling someone to go there before they have been asked once
  // is the fastest way to lose them.
  return response.canAskAgain ? 'undetermined' : 'denied';
}

export async function getPermission(): Promise<PermissionState> {
  return toState(await Notifications.getPermissionsAsync());
}

/**
 * Asks, unless the OS has already decided. Returns the state either way.
 *
 * Android 13+ needs this at runtime for POST_NOTIFICATIONS; older Androids grant it at
 * install time and this resolves immediately.
 */
export async function requestPermission(): Promise<PermissionState> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || !current.canAskAgain) return toState(current);

  return toState(await Notifications.requestPermissionsAsync());
}

/**
 * Replaces every pending reminder with exactly this set. Returns how many were armed.
 *
 * Cancel-then-schedule rather than a diff: `armWindow` output shifts wholesale when a person
 * is added, a lead time changes, or a day passes, so reconciling would be more code to get
 * subtly wrong for no gain at this size.
 */
export async function syncReminders(reminders: Reminder[]): Promise<number> {
  return serialize(async () => {
    await configureNotifications();

    // Cancelled before the permission check, not after. Permission can be revoked while the
    // app is backgrounded, and the reminders armed under the old grant survive that — so
    // returning early without clearing them leaves a window the user has just switched off
    // still firing.
    await Notifications.cancelAllScheduledNotificationsAsync();
    if ((await getPermission()) !== 'granted') return 0;

    for (const reminder of reminders) {
      const { title, body } = reminderCopy(reminder);
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { ...REMINDER_DATA, personId: reminder.personId } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.fireAt,
          channelId: CHANNEL_ID,
        },
      });
    }

    return reminders.length;
  });
}

/** Pending reminders, for the settings screen to show and for verifying the cap on a device. */
export async function countPending(): Promise<number> {
  return (await Notifications.getAllScheduledNotificationsAsync()).length;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs tasks one at a time.
 *
 * `syncReminders` cancels everything before it schedules anything. Two overlapping calls —
 * a write landing while the app returns to the foreground — would interleave that cancel
 * into the middle of the other's scheduling loop, leaving a half-armed window. Serialising
 * is a cheaper fix than making the sync itself re-entrant.
 */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  // Swallowed on the queue only: a rejected sync must not poison every later one. The
  // returned promise still rejects, so the caller sees the failure.
  queue = next.catch(() => undefined);
  return next;
}
