import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { ActivityIndicator, StyleSheet, useColorScheme } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { db, migrations } from '@/db/client';
import { useNotificationTap } from '@/notifications/use-notification-tap';
import { useReminders } from '@/notifications/use-reminders';

/**
 * React Navigation draws the headers and the screen behind them, so it needs the same
 * surfaces the app does. Its own dark theme is near-black (`card` is `rgb(18, 18, 18)`),
 * which left a visible seam under the header once `background` stopped being black.
 */
function navigationTheme(scheme: 'light' | 'dark') {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const colors = Colors[scheme];

  return {
    ...base,
    colors: {
      ...base.colors,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.backgroundSelected,
      primary: colors.tint,
    },
  };
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Runs pending migrations before anything queries a table. Every screen below this point
  // can assume the schema exists.
  const { success, error } = useMigrations(db, migrations);

  return (
    <ThemeProvider value={navigationTheme(colorScheme === 'dark' ? 'dark' : 'light')}>
      {error ? <MigrationFailed error={error} /> : success ? <AppStack /> : <Starting />}
    </ThemeProvider>
  );
}

/**
 * A Stack wrapping the tab group, rather than tabs at the root.
 *
 * The add and edit screens push over the tab bar. With `Tabs` at the root, every route file
 * outside the declared screens would silently become another tab.
 *
 * `useReminders` lives here rather than in the root component because it queries `person`
 * and `settings`. Above this point the migrations may not have run yet.
 */
function AppStack() {
  useReminders();
  useNotificationTap();

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="person/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="person/[id]" />
      <Stack.Screen name="message/[id]" />
    </Stack>
  );
}

function Starting() {
  return (
    <ThemedView style={styles.centred}>
      <ActivityIndicator />
    </ThemedView>
  );
}

/**
 * A failed migration is unrecoverable from inside the app and must not be silent — carrying
 * on would run every query against a schema that does not match the code.
 */
function MigrationFailed({ error }: { error: Error }) {
  return (
    <ThemedView style={styles.centred}>
      <ThemedText type="subtitle">Nenrin could not start</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.centredText}>
        The local database could not be prepared. Reinstalling the app will clear it, but any
        birthdays saved on this device will be lost.
      </ThemedText>
      <ThemedText type="code" themeColor="textSecondary">
        {error.message}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  centredText: {
    textAlign: 'center',
  },
});
