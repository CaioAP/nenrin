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
 *
 * **`expo-notifications` is loaded lazily and never in Expo Go.** See `loadNotifications`.
 */

import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

import { reminderCopy } from '@/domain/reminder-copy';
import type { Reminder } from '@/domain/schedule';

/** Type-only, so nothing about the package is pulled in at module scope. */
type NotificationsModule = typeof import('expo-notifications');

/**
 * Android requires a channel before anything can be posted, and one created lazily at
 * schedule time shows up in system settings with a generic name. Naming it means the user
 * can silence birthday reminders without silencing the app.
 */
const CHANNEL_ID = 'birthdays';

/** Marks our notifications so a cancel-all never reaches a notification we did not post. */
const REMINDER_DATA = { kind: 'birthday-reminder' } as const;

let loading: Promise<NotificationsModule | null> | null = null;

/**
 * `expo-notifications`, or null where it cannot be used.
 *
 * A plain `import` of this package **crashes the whole app in Expo Go on Android**, and not
 * for any reason to do with what we call. The barrel re-exports
 * `DevicePushTokenAutoRegistration.fx`, which registers a push-token listener at module
 * scope; that listener throws in Expo Go because remote push was removed from it in SDK 53.
 * Importing is enough — every route below the import fails to evaluate and the app dies at
 * launch with "missing the required default export".
 *
 * So the module is reached only through a dynamic import, behind an Expo Go check. Local
 * notifications genuinely do work in a development build; Expo Go simply cannot load the
 * package at all. Everything else in the app is unaffected, which is the behaviour we want
 * anyway — reminders are an enhancement, not a precondition for tracking a birthday.
 *
 * Exported so the tap handler can reach the module through the same guard. Nothing else
 * may import `expo-notifications` directly.
 */
export function loadNotifications(): Promise<NotificationsModule | null> {
  loading ??= (async () => {
    if (isRunningInExpoGo()) return null;
    return await import('expo-notifications');
  })().catch((error) => {
    // Not cached as a permanent failure — the next sync retries.
    loading = null;
    throw error;
  });

  return loading;
}

/** Whether reminders can work at all in this build. False in Expo Go. */
export async function notificationsAvailable(): Promise<boolean> {
  return (await loadNotifications()) !== null;
}

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
    const notifications = await loadNotifications();
    if (!notifications) return;

    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Birthdays',
        importance: notifications.AndroidImportance.DEFAULT,
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

/** `unsupported` is Expo Go: not a decision the user made, and not one they can change. */
export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

function toState(response: { granted: boolean; canAskAgain: boolean }): PermissionState {
  if (response.granted) return 'granted';
  // `canAskAgain` distinguishes "not asked yet" from "said no". Only the latter needs the
  // settings-app detour, and telling someone to go there before they have been asked once
  // is the fastest way to lose them.
  return response.canAskAgain ? 'undetermined' : 'denied';
}

export async function getPermission(): Promise<PermissionState> {
  const notifications = await loadNotifications();
  if (!notifications) return 'unsupported';

  return toState(await notifications.getPermissionsAsync());
}

/**
 * Asks, unless the OS has already decided. Returns the state either way.
 *
 * Android 13+ needs this at runtime for POST_NOTIFICATIONS; older Androids grant it at
 * install time and this resolves immediately.
 */
export async function requestPermission(): Promise<PermissionState> {
  const notifications = await loadNotifications();
  if (!notifications) return 'unsupported';

  const current = await notifications.getPermissionsAsync();
  if (current.granted || !current.canAskAgain) return toState(current);

  return toState(await notifications.requestPermissionsAsync());
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
    const notifications = await loadNotifications();
    if (!notifications) return 0;

    await configureNotifications();

    // Cancelled before the permission check, not after. Permission can be revoked while the
    // app is backgrounded, and the reminders armed under the old grant survive that — so
    // returning early without clearing them leaves a window the user has just switched off
    // still firing.
    await notifications.cancelAllScheduledNotificationsAsync();
    if ((await getPermission()) !== 'granted') return 0;

    for (const reminder of reminders) {
      const { title, body } = reminderCopy(reminder);
      await notifications.scheduleNotificationAsync({
        content: { title, body, data: { ...REMINDER_DATA, personId: reminder.personId } },
        trigger: {
          type: notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.fireAt,
          channelId: CHANNEL_ID,
        },
      });
    }

    return reminders.length;
  });
}

/**
 * Fires one notification a few seconds from now. Development only.
 *
 * Reminders can only fire at the configured time of day, so proving delivery works would
 * otherwise mean waiting until 09:00 — for each of three separate questions (does it fire,
 * what is the real pending cap, does the Android 13 permission flow work). This makes each
 * of them a one-minute experiment.
 *
 * Returns false when it could not be scheduled, so the caller can say so rather than
 * leaving someone waiting for a notification that was never armed.
 *
 * Caveat worth knowing while testing: `syncReminders` cancels *everything* pending, so any
 * re-arm — a settings change, a write, or returning to the foreground — wipes this too.
 * Background the app and leave it alone once you have tapped.
 */
export async function scheduleTestReminder(inSeconds = 60): Promise<TestReminderResult> {
  const notifications = await loadNotifications();
  if (!notifications) return 'unsupported';

  await configureNotifications();

  // Requests rather than checks. Unlike `syncReminders` — which runs unprompted and must
  // never make a dialog appear out of nowhere — this only runs because someone tapped it,
  // so prompting is exactly what they asked for.
  const permission = await requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'undetermined';

  await notifications.scheduleNotificationAsync({
    content: {
      title: 'Test reminder',
      body: `Armed ${inSeconds}s earlier. Delivery works.`,
      data: { ...REMINDER_DATA, test: true },
    },
    trigger: {
      type: notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: inSeconds,
      repeats: false,
      channelId: CHANNEL_ID,
    },
  });

  return 'armed';
}

/** Distinguishes the three ways a test can fail, so the panel can say which one happened. */
export type TestReminderResult = 'armed' | 'unsupported' | 'denied' | 'undetermined';

/** Pending reminders, for the settings screen to show and for verifying the cap on a device. */
export async function countPending(): Promise<number> {
  const notifications = await loadNotifications();
  if (!notifications) return 0;

  return (await notifications.getAllScheduledNotificationsAsync()).length;
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
