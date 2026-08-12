/**
 * Opens the right person when a birthday reminder is tapped.
 *
 * The Expo docs show this as a module-scope `import * as Notifications` plus the
 * `useLastNotificationResponse` hook. Neither works here: a module-scope import of
 * `expo-notifications` crashes the entire app in Expo Go on Android at launch (see
 * AGENTS.md), and a hook cannot be reached through a dynamic import. So the module arrives
 * through `loadNotifications()` inside an effect, and the two cases are handled by hand:
 *
 * - `getLastNotificationResponse()` — the app was closed when the notification was tapped
 *   and is starting because of it.
 * - `addNotificationResponseReceivedListener` — the app was already running.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';

import { loadNotifications } from './reminders';

/**
 * Type-only, so naming the response shape costs nothing at runtime — the same trick
 * `reminders.ts` uses for `NotificationsModule`. A value import here would be the crash.
 */
type NotificationResponse = import('expo-notifications').NotificationResponse;

export function useNotificationTap(): void {
  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | undefined;

    (async () => {
      const notifications = await loadNotifications();
      // Expo Go, where reminders cannot exist in the first place. Every other route works.
      if (!notifications || cancelled) return;

      const open = (response: NotificationResponse) => {
        // A response can also come from a notification *action*; only a plain tap should
        // navigate. The development test reminder carries no personId and is ignored here.
        if (response.actionIdentifier !== notifications.DEFAULT_ACTION_IDENTIFIER) return;

        const personId = response.notification.request.content.data?.personId;
        if (typeof personId !== 'string') return;

        router.push(`/person/${personId}`);
      };

      const last = notifications.getLastNotificationResponse();
      if (last) open(last);

      subscription = notifications.addNotificationResponseReceivedListener(open);
    })().catch((error) => {
      // Failing to attach the listener costs a shortcut, not the app: every birthday is
      // still one tap away in Upcoming.
      console.warn('Could not observe notification taps', error);
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);
}
