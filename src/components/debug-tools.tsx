import * as Contacts from 'expo-contacts';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { addSamplePeople, removeSamplePeople } from '@/db/sample-people';
import { scanContacts } from '@/hooks/use-contact-scan';
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

      <ActionButton
        label="Probe contacts"
        disabled={busy}
        onPress={() => run('Probing', probeContacts)}
      />

      <ActionButton
        label="Scan contacts for candidates"
        disabled={busy}
        onPress={() => run('Scanning', runContactScan)}
      />

      {status ? (
        <ThemedText type="small" themeColor="textSecondary">
          {status}
        </ThemedText>
      ) : null}
    </View>
  );
}

const PROBE_SAMPLE_LIMIT = 10;

/**
 * Android's native `ContactField` enum has no `BIRTHDAY` member — it is one of exactly two
 * (with `NON_GREGORIAN_BIRTHDAY`) that the TypeScript enum declares and
 * `android/.../records/fields/ContactField.kt` omits. Requesting it does not degrade to an
 * empty field: argument conversion fails and the whole `getAllDetails` call rejects with
 * `Couldn't convert 'birthday' to ContactField`. So the field list itself is a platform fork,
 * separate from the fork over where the birthday then turns up.
 *
 * The four fields that Kotlin file marks "iOS only" are present in the enum and convert
 * fine — they just return nothing. Only the two birthday members are absent.
 */
const PROBE_FIELDS = {
  ios: [
    Contacts.ContactField.FULL_NAME,
    Contacts.ContactField.BIRTHDAY,
    Contacts.ContactField.DATES,
    Contacts.ContactField.PHONES,
  ],
  android: [
    Contacts.ContactField.FULL_NAME,
    Contacts.ContactField.DATES,
    Contacts.ContactField.PHONES,
  ],
} as const;

/** The subset of a contact this probe reads, whichever field list produced it. */
type ProbedContact = {
  fullName?: string | null;
  birthday?: Contacts.ContactDate | null;
  dates?: readonly Contacts.ExistingDate[];
  phones?: readonly Contacts.ExistingPhone[];
};

/**
 * Dumps what the platform actually returns for birthdays, because the SDK types cannot say.
 *
 * `dates[].label` is typed as a bare string and documented with "birthday" only as an
 * example. The module's own Kotlin says it is the fixed English word — `EventLabelMapper`
 * maps `Event.TYPE_BIRTHDAY` to the literal `"birthday"` regardless of locale — but that is
 * a prediction from reading a dependency's source, and the matcher is worth more than the
 * prediction. Guessing wrong fails silently: an unmatched label makes a contact look like it
 * has no birthday, which is indistinguishable from one that genuinely has none.
 *
 * Reports only contacts carrying at least one date — a contact with none says nothing about
 * labelling — and caps the sample, because the question is what the strings look like and
 * ten answers that as well as four hundred.
 */
async function probeContacts(): Promise<string> {
  const permission = await Contacts.requestPermissionsAsync();
  if (!permission.granted) {
    return `Permission not granted (accessPrivileges: ${permission.accessPrivileges ?? 'unknown'})`;
  }

  const contacts: readonly ProbedContact[] = await (Platform.OS === 'ios'
    ? Contacts.Contact.getAllDetails(PROBE_FIELDS.ios)
    : Contacts.Contact.getAllDetails(PROBE_FIELDS.android));

  const withDates = contacts.filter((contact) => (contact.dates?.length ?? 0) > 0);
  const withBirthdayField = contacts.filter((contact) => contact.birthday != null);
  // A weak control, kept for what it does prove: that the Data-table query ran and returned
  // rows at all. It cannot prove more. `Event.START_DATE/TYPE/LABEL` are DATA1/2/3 — the same
  // columns as `Phone.NUMBER/TYPE/LABEL` — so the only thing separating a date read from a
  // phone read is the mimetype in the selection, and that is exactly what this does not vary.
  // The decisive test is a birthday set by hand in the phone's own Contacts app.
  const withPhones = contacts.filter((contact) => (contact.phones?.length ?? 0) > 0);

  const lines = withDates.slice(0, PROBE_SAMPLE_LIMIT).map((contact) => {
    const dates = (contact.dates ?? [])
      .map((entry) => `    label=${JSON.stringify(entry.label)} date=${JSON.stringify(entry.date)}`)
      .join('\n');
    return `${contact.fullName ?? '(no name)'}\n  birthday=${JSON.stringify(contact.birthday)}\n${dates}`;
  });

  return [
    `${Platform.OS}, accessPrivileges: ${permission.accessPrivileges ?? 'unknown'}`,
    `${contacts.length} contacts`,
    `  ${withDates.length} carry a dates[] entry`,
    `  ${withBirthdayField.length} carry a birthday field`,
    `  ${withPhones.length} carry a phone (control — 0 here too means the read is broken)`,
    '',
    ...(lines.length > 0 ? lines : ['No dates to sample.']),
  ].join('\n');
}

/** How many candidate names to print. Enough to recognise, few enough to read. */
const SCAN_SAMPLE_LIMIT = 5;

/**
 * The whole import read path in one tap: adapter → mapper → partitioner, over the real
 * database sets.
 *
 * This exists because every module below it was otherwise unreachable. Nothing imported
 * `contacts.ts` or `db/skipped.ts` until the import UI is built in step 6 — and an orphan
 * module is not bundled, so `expo export` passing said nothing about either of them. Now the
 * button reaches both through `@/hooks/use-contact-scan`, which is what makes that gate mean
 * something, and what makes the device checks runnable before a single screen exists.
 *
 * Expect a large candidate count and almost no birthdays. That is the correct result on an
 * address book that holds none, not a failure.
 */
async function runContactScan(): Promise<string> {
  const { access, partitioned } = await scanContacts();
  if (access === 'none') {
    // Not an error path. The app must stay fully usable with contacts denied.
    return 'Access: none. Nothing scanned, nothing thrown — which is the point.';
  }

  const { ready, needsBirthday, alreadyKnown } = partitioned;
  const total = ready.length + needsBirthday.length + alreadyKnown.length;

  const withBirthday = ready
    .slice(0, SCAN_SAMPLE_LIMIT)
    .flatMap((candidate) => {
      // `ready` is defined by having a birthday, so this never drops anything. It is a
      // flatMap rather than a `?? { month: 0 }` fallback because a fallback that fired
      // would print 0/0 as though it were data the phone gave us.
      const birthday = candidate.birthday;
      if (!birthday) return [];
      const { month, day, year } = birthday;
      return [`  ${candidate.displayName} — ${day}/${month}${year ? `/${year}` : ''}`];
    })
    .join('\n');

  return [
    `Access: ${access}`,
    `${total} candidates named`,
    `  ready: ${ready.length}`,
    `  needsBirthday: ${needsBirthday.length}`,
    `  alreadyKnown: ${alreadyKnown.length}`,
    '',
    // Printed day/month so a month-base error is visible rather than plausible.
    withBirthday || 'No candidate carried a birthday.',
  ].join('\n');
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two, paddingTop: Spacing.three },
});
