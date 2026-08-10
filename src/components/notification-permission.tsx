import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNotificationPermission } from '@/notifications/use-reminders';
import { ThemedText } from './themed-text';

/**
 * The "reminders are off" prompt. Renders nothing at all once permission is granted.
 *
 * Shown on Upcoming as well as in Settings, and that is the point: a user can install the
 * app, add every birthday they know from the People tab, and never open Settings. Asking
 * only there means reminders silently never work for them — which is the single failure
 * this whole feature exists to prevent. A permanent "notifications: on" row would be noise;
 * the only states worth surfacing are the two where nothing will fire.
 */
export function NotificationPermission() {
  const theme = useTheme();
  const { permission, ask } = useNotificationPermission();

  if (permission === null || permission === 'granted') return null;

  // Expo Go cannot load expo-notifications at all (see `loadNotifications`). Only a
  // developer ever sees this, so it says what actually fixes it and offers no button —
  // there is nothing to tap that would help.
  if (permission === 'unsupported') {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Reminders are unavailable in Expo Go. Run a development build to test them.
      </ThemedText>
    );
  }

  // Once the OS has been told no, asking again does nothing — the request resolves
  // instantly with the same answer and the user sees a button that appears broken. The
  // system settings screen is the only route back, but sending someone there before they
  // have ever been asked is a detour they should not need.
  const denied = permission === 'denied';

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">Reminders are off</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {denied
          ? 'Notifications are blocked for Nenrin. Birthdays still show up here, but nothing will tell you about them.'
          : 'Nenrin needs permission to notify you before a birthday.'}
      </ThemedText>
      <Pressable
        onPress={() => (denied ? Linking.openSettings() : ask())}
        accessibilityRole="button"
        style={[styles.action, { backgroundColor: theme.tint }]}
      >
        <ThemedText type="smallBold" themeColor="onTint">
          {denied ? 'Open system settings' : 'Allow notifications'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  action: {
    minHeight: 44,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
});
