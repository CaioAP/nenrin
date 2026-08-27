import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ImportCalendarSection } from '@/components/import-calendar-section';
import { ImportContactsSection } from '@/components/import-contacts-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Where an import starts.
 *
 * Two sources, presented as two independent offers. Independent all the way down: each
 * section runs its own scan and owns its own failure, so a denied permission on one shows a
 * message *inside* that section instead of replacing the screen. The previous version
 * returned full-screen for contacts scanning, failing or denied — which meant a user with
 * contacts off never saw the calendar half at all, and calendars are the higher-yield source
 * on the device this was measured on.
 */
export default function ImportScreen() {
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Import' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ImportContactsSection />

        <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />

        <ImportCalendarSection />

        <ThemedText type="small" themeColor="textSecondary">
          Birthdays you add here are saved in Nenrin only. Your contacts and calendars are never
          changed.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four },
  divider: { height: StyleSheet.hairlineWidth },
});
