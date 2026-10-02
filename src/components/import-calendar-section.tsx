import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { clearDeferred, countDeferred } from '@/db/skipped';
import { cardsFor } from '@/domain/import';
import { useSourceScan } from '@/hooks/use-source-scan';
import { calendarSource, hiddenCalendarTitles } from '@/sources/calendar';
import { ActionButton } from './action-button';
import { ThemedText } from './themed-text';

/**
 * The calendars half of the import screen.
 *
 * Independent of the contacts half by construction — separate component, separate scan,
 * separate error state. On the development device this is the higher-yield source of the
 * two: ten birthdays against the address book's two.
 *
 * No "import these" button, unlike contacts. Calendar candidates all carry a date, so they
 * land in `ready` — but `ready` means "has a date", not "import without asking". These names
 * are parsed out of free text and the duplicates are real (`Pai's birthday` appears twice on
 * the test phone), so every one goes through the deck. `cardsFor` is where that is decided.
 */
export function ImportCalendarSection() {
  const router = useRouter();
  const { scan, rescan } = useSourceScan(calendarSource);
  const [hidden, setHidden] = useState<string[]>([]);
  const [deferred, setDeferred] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * The hidden count is read beside the scan rather than carried inside `ScanResult`.
   *
   * Same reasoning that keeps `hiddenCalendarTitles` off `BirthdaySource`: it is one
   * platform's quirk, and putting it in the type every source shares would make every future
   * source answer a question only this one has. Nothing goes wrong if it stays local.
   */
  const readAside = useCallback(() => {
    hiddenCalendarTitles()
      .then((titles) => {
        if (alive.current) setHidden(titles);
      })
      // Caught, unlike the count below. Every method of `ExpoGoCalendarNextStub` throws, and
      // Expo Go is exactly where a developer opens this screen first — an unhandled rejection
      // there is console noise around a notice that simply has nothing to say.
      .catch(() => {
        if (alive.current) setHidden([]);
      });
    countDeferred('calendar').then((total) => {
      if (alive.current) setDeferred(total);
    });
  }, []);

  // Re-read whenever the scan settles, not only on mount.
  //
  // `hiddenCalendarTitles` opens with `getCalendarPermissions`, the non-prompting check —
  // which answers "not granted" while `useSourceScan`'s own permission prompt is still on
  // screen. A mount-only read therefore reports zero hidden calendars on a first run and
  // never corrects itself: the `firstFocus` guard below suppresses the first focus refresh,
  // and if every birthday is in a hidden calendar there is no button to navigate away from
  // and come back to. The screen would say "No birthdays found in your calendars" — the one
  // sentence the visibility trap makes a lie.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `scan.state` is the trigger, not a value read here
  useEffect(readAside, [readAside, scan.state]);

  const refresh = useCallback(() => {
    setWriteError(null);
    rescan();
    readAside();
  }, [rescan, readAside]);

  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      refresh();
    }, [refresh]),
  );

  /**
   * Shown under every outcome, including a successful one.
   *
   * "No birthdays found" is a lie whenever a calendar is hidden, and from inside the API the
   * two are indistinguishable — `expo-calendar` hardcodes `Instances.VISIBLE = 1`, so a
   * hidden calendar returns zero events exactly like an empty one. It appears above a count
   * of ten too, because the eleventh may be in the hidden one.
   *
   * The copy names the *device's* calendar app rather than Google Calendar. On the Samsung
   * test phone the calendars read as ticked inside Google Calendar the whole time while
   * Samsung Calendar — which owns the column there — had them hidden. Nenrin cannot fix it
   * either: `isVisible` is read-only from JavaScript.
   */
  const hiddenNotice =
    hidden.length > 0 ? (
      <ThemedText type="small" themeColor="textSecondary">
        {`⚠ ${hidden.length === 1 ? 'One calendar is' : `${hidden.length} calendars are`} hidden and cannot be read: ${hidden.join(', ')}. Nenrin cannot switch them on — do it in the calendar app that manages them on this device, which may not be the one you usually open.`}
      </ThemedText>
    ) : null;

  if (scan.state === 'scanning') {
    return (
      <View style={styles.section}>
        <ActivityIndicator />
        <ThemedText themeColor="textSecondary">Reading your calendars…</ThemedText>
      </View>
    );
  }

  if (scan.state === 'failed') {
    return (
      <View style={styles.section}>
        <ThemedText type="subtitle">Could not read your calendars</ThemedText>
        <ThemedText themeColor="textSecondary">{scan.error.message}</ThemedText>
        <ActionButton label="Try again" onPress={refresh} />
      </View>
    );
  }

  const { access, partitioned } = scan.result;

  if (access === 'none') {
    return (
      <View style={styles.section}>
        <ThemedText type="subtitle">Calendars are off</ThemedText>
        <ThemedText themeColor="textSecondary">
          Nenrin cannot read your calendars, so it cannot find the birthdays already saved there.
          Everything else still works — turn calendars on later in your device settings.
        </ThemedText>
        <ActionButton label="Check again" onPress={refresh} />
      </View>
    );
  }

  const cards = cardsFor('calendar', partitioned);

  const askAgain = async () => {
    if (restoring) return;
    setRestoring(true);
    setWriteError(null);
    try {
      await clearDeferred('calendar');
      refresh();
    } catch (cause) {
      setWriteError(cause instanceof Error ? cause.message : 'Could not restore those birthdays.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      <View style={styles.section}>
        <ThemedText type="subtitle">
          {cards.length === 0
            ? 'No birthdays found in your calendars'
            : `${cards.length} birthday${cards.length === 1 ? '' : 's'} in your calendars`}
        </ThemedText>
        {cards.length > 0 ? (
          <>
            <ThemedText themeColor="textSecondary">
              Nenrin reads the name out of the event title, so check each one before saving it.
            </ThemedText>
            <ActionButton
              label="Go through them"
              onPress={() => router.push({ pathname: '/triage', params: { source: 'calendar' } })}
            />
          </>
        ) : null}
        {hiddenNotice}
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
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two, alignItems: 'flex-start' },
});
