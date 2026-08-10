import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSettings } from '@/db/hooks';
import { updateSettings } from '@/db/settings';
import { LEAP_DAY_POLICIES } from '@/domain/birthday';
import {
  describeLeadDays,
  describeLeapDayPolicy,
  formatTimeOfDay,
  LEAD_DAY_CHOICES,
  NOTIFY_TIME_CHOICES,
} from '@/domain/settings';
import { useTheme } from '@/hooks/use-theme';
import { useNotificationPermission } from '@/notifications/use-reminders';

/**
 * Everything here writes straight through `updateSettings` with no save button.
 *
 * The reminder window re-arms itself off the settings row, so a change is live the moment
 * it lands — a Save step would only add a way to lose the change.
 */
export default function SettingsScreen() {
  const { settings } = useSettings();

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <NotificationPermission />

        <Section
          title="Remind me"
          hint="How far ahead of a birthday to be told, unless a person overrides it."
        >
          {LEAD_DAY_CHOICES.map((days) => (
            <Chip
              key={days}
              label={describeLeadDays(days)}
              selected={settings.defaultLeadDays === days}
              onPress={() => updateSettings({ defaultLeadDays: days })}
            />
          ))}
        </Section>

        <Section title="At" hint="The time of day reminders arrive.">
          {NOTIFY_TIME_CHOICES.map((hour) => (
            <Chip
              key={hour}
              label={formatTimeOfDay(hour, 0)}
              selected={settings.notifyHour === hour}
              onPress={() => updateSettings({ notifyHour: hour, notifyMinute: 0 })}
            />
          ))}
        </Section>

        <Section
          title="29 February birthdays"
          hint="Which day to celebrate on in the three years out of four that have no 29th."
        >
          {LEAP_DAY_POLICIES.map((policy) => (
            <Chip
              key={policy}
              label={describeLeapDayPolicy(policy)}
              selected={settings.leapDayPolicy === policy}
              onPress={() => updateSettings({ leapDayPolicy: policy })}
            />
          ))}
        </Section>

        <ThemedText type="small" themeColor="textSecondary">
          Nenrin stores everything on this device. Nothing is sent anywhere.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

/**
 * The permission row, which says nothing at all once permission is granted.
 *
 * A permanent "Notifications: on" line is noise for the state the app is supposed to be in.
 * The two states worth surfacing are the ones where reminders silently do not work.
 */
function NotificationPermission() {
  const theme = useTheme();
  const { permission, ask } = useNotificationPermission();

  if (permission === 'granted') return null;

  const denied = permission === 'denied';

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Reminders are off</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {denied
          ? 'Notifications are blocked for Nenrin. Birthdays still show in the app, but nothing will tell you about them.'
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

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {hint}
      </ThemedText>
      <View style={styles.choices}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  section: { gap: Spacing.two },
  // Wraps rather than scrolls: unlike the day picker these sets are short, and a row that
  // scrolls without looking scrollable hides options.
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  action: {
    minHeight: 44,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
});
