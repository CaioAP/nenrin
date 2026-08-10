import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { addSamplePeople, removeSamplePeople } from '@/db/sample-people';
import { useForegroundTime } from '@/hooks/use-foreground-time';
import { countPending, scheduleTestReminder } from '@/notifications/reminders';
import { ActionButton } from './action-button';
import { ThemedText } from './themed-text';

const TEST_REMINDER_SECONDS = 60;
const SAMPLE_COUNT = 300;

/**
 * Development-only tools for the three questions only a device can answer.
 *
 * Reminders fire at a configured time of day, so without these, confirming delivery works
 * means waiting until 09:00 — once per question. Nothing here ships: `__DEV__` is false in
 * any release build, so the whole section disappears along with its imports.
 */
export function DebugTools() {
  // Split in two so the panel's hooks never run in a release build. A `__DEV__` check
  // *inside* the panel would still have to sit after its hooks, which means production
  // would keep polling the notification count for a component that renders nothing.
  return __DEV__ ? <DebugPanel /> : null;
}

function DebugPanel() {
  const [pending, setPending] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const foregroundAt = useForegroundTime();

  const refresh = useCallback(async () => setPending(await countPending()), []);

  // Re-counted on every foreground, which is also when the window is re-armed — so the
  // number shown is the one that survived the most recent sync.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-count on every foreground
  useEffect(() => {
    refresh();
  }, [refresh, foregroundAt]);

  const run = async (label: string, task: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setStatus(`${label}…`);
    try {
      setStatus(await task());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">Debug</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Development builds only. Pending notifications: {pending ?? '—'}
      </ThemedText>

      <ActionButton
        label={`Fire a test reminder in ${TEST_REMINDER_SECONDS}s`}
        disabled={busy}
        onPress={() =>
          run('Arming', async () => {
            switch (await scheduleTestReminder(TEST_REMINDER_SECONDS)) {
              case 'armed':
                return 'Armed. Background the app now — any re-arm cancels it.';
              case 'unsupported':
                return 'expo-notifications could not load. Expo Go cannot run reminders.';
              case 'denied':
                return 'Notifications are blocked. Allow them in system settings.';
              case 'undetermined':
                return 'Permission was not granted.';
            }
          })
        }
      />

      <ActionButton
        label={`Add ${SAMPLE_COUNT} sample people`}
        disabled={busy}
        onPress={() =>
          run('Adding', async () => {
            const added = await addSamplePeople(SAMPLE_COUNT);
            // The count below is what actually answers the cap question: arm far more
            // reminders than the window allows and see how many the OS keeps.
            return `Added ${added}. Reopen the app to re-arm, then check the count above.`;
          })
        }
      />

      <ActionButton
        label="Remove sample people"
        disabled={busy}
        onPress={() =>
          run('Removing', async () => {
            await removeSamplePeople();
            return 'Removed everyone tagged as a sample.';
          })
        }
      />

      {status ? (
        <ThemedText type="small" themeColor="textSecondary">
          {status}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two, paddingTop: Spacing.three },
});
