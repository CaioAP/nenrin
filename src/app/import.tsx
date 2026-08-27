import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { createFromCandidates } from '@/db/people';
import { clearDeferred, countDeferred } from '@/db/skipped';
import { useSourceScan } from '@/hooks/use-source-scan';
import { useTheme } from '@/hooks/use-theme';
import { contactsSource } from '@/sources/contacts';

/**
 * Where an import starts.
 *
 * The two decisions are presented separately and never nested. Importing the handful of
 * contacts that already carry a birthday is free and instant; filling in the hundreds that
 * do not is real work. Putting both behind one button would either do the work unasked or
 * hide the free win behind it.
 */
export default function ImportScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { scan, rescan } = useSourceScan(contactsSource);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const [deferred, setDeferred] = useState(0);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Tracks mount state across both the effect below and `refresh`, so a count that
  // resolves after the screen is gone never calls `setDeferred` on a dead component.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Read alongside every scan, because "ask me again" must disappear the moment it is used
  // and reappear the moment the deck defers something.
  useEffect(() => {
    countDeferred('contacts').then((total) => {
      if (alive.current) setDeferred(total);
    });
  }, []);

  const refresh = useCallback(() => {
    // Any refresh retires a stale receipt — the count it describes may no longer be true
    // once the candidate lists have been re-read. The same goes for a failure message:
    // without this it would outlive the condition that caused it, sitting on screen across
    // navigation until the user happened to retry that exact action.
    setImported(null);
    setWriteError(null);
    rescan();
    countDeferred('contacts').then((total) => {
      if (alive.current) setDeferred(total);
    });
  }, [rescan]);

  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // `useSourceScan` already scans on mount, so refreshing on the first focus would
      // read the address book twice for one entry. Only a *return* needs the refresh —
      // the deck runs while this screen stays mounted underneath it, so its counts and
      // its deferred total are both stale by the time the user comes back.
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refresh();
    }, [refresh]),
  );

  if (scan.state === 'scanning') {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Import' }} />
        <ActivityIndicator />
        <ThemedText themeColor="textSecondary">Reading your contacts…</ThemedText>
      </ThemedView>
    );
  }

  if (scan.state === 'failed') {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Import' }} />
        <ThemedText type="subtitle">Could not read your contacts</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centredText}>
          {scan.error.message}
        </ThemedText>
        <ActionButton label="Try again" onPress={refresh} />
      </ThemedView>
    );
  }

  const { access, partitioned } = scan.result;

  if (access === 'none') {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Import' }} />
        <ThemedText type="subtitle">Contacts are off</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centredText}>
          Nenrin cannot read your address book. Everything else still works — you can add people by
          hand, and turn contacts on later in your device settings.
        </ThemedText>
        <ActionButton label="Check again" onPress={refresh} />
      </ThemedView>
    );
  }

  const { ready, needsBirthday } = partitioned;

  const importReady = async () => {
    if (importing) return;
    setImporting(true);
    setWriteError(null);
    try {
      const count = await createFromCandidates(ready);
      // `refresh` clears `imported` as part of retiring any stale receipt — call it before
      // setting the real count, not after, or it would erase the very receipt this import
      // just earned.
      refresh();
      setImported(count);
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : 'Could not add those contacts.');
    } finally {
      // Cleared even on failure, or a rejected write would leave the button dead forever.
      setImporting(false);
    }
  };

  const askAgain = async () => {
    if (restoring) return;
    setRestoring(true);
    setWriteError(null);
    try {
      await clearDeferred('contacts');
      refresh();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : 'Could not restore those contacts.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Import' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {access === 'limited' ? (
          <ThemedText type="small" themeColor="textSecondary">
            You have shared some of your contacts with Nenrin, not all of them. These counts cover
            only what you shared.
          </ThemedText>
        ) : null}

        <View style={styles.section}>
          {/*
           * The zero-state has to be true in every way of arriving at it: nothing ever had a
           * birthday, they were imported a moment ago, or they were imported on a previous
           * visit and `imported` has since been reset by a remount. Wording that holds in all
           * three beats a branch per case — the first version of this had a branch and still
           * lied on the third.
           */}
          <ThemedText type="subtitle">
            {ready.length > 0
              ? `${describeContacts(ready.length)} already ${ready.length === 1 ? 'has' : 'have'} a birthday`
              : 'No contacts with a birthday left to import'}
          </ThemedText>
          {ready.length > 0 ? (
            <ActionButton
              label={
                importing
                  ? 'Importing…'
                  : `Import ${ready.length === 1 ? 'this one' : `these ${ready.length}`}`
              }
              onPress={importReady}
              disabled={importing}
            />
          ) : null}
          {imported !== null ? (
            <ThemedText type="small" themeColor="textSecondary">
              Added {describeContacts(imported)}.
            </ThemedText>
          ) : null}
        </View>

        <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />

        <View style={styles.section}>
          <ThemedText type="subtitle">
            {needsBirthday.length === 0
              ? 'Nothing left to go through'
              : `${describeContacts(needsBirthday.length)} ${needsBirthday.length === 1 ? 'has' : 'have'} none`}
          </ThemedText>
          {needsBirthday.length > 0 ? (
            <>
              <ThemedText themeColor="textSecondary">
                Nenrin can ask you about them one at a time. Skip anyone you do not know — you can
                always come back.
              </ThemedText>
              <ActionButton label="Start" onPress={() => router.push('/triage')} />
            </>
          ) : null}
        </View>

        {deferred > 0 ? (
          <View style={styles.section}>
            <ActionButton
              label={`Ask me again about the ${deferred} I skipped`}
              onPress={askAgain}
              disabled={restoring}
            />
          </View>
        ) : null}

        {writeError ? (
          <ThemedText type="small" themeColor="textSecondary">
            {writeError}
          </ThemedText>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary">
          Birthdays you add here are saved in Nenrin only. Your contacts are never changed.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

function describeContacts(count: number): string {
  return `${count} contact${count === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four },
  section: { gap: Spacing.two, alignItems: 'flex-start' },
  divider: { height: StyleSheet.hairlineWidth },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  centredText: { textAlign: 'center' },
});
