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

      <ActionButton
        label="Probe calendars"
        disabled={busy}
        onPress={() => run('Probing', probeCalendars)}
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

/** How many calendars and events to print. The question is what the strings look like. */
const CALENDAR_SAMPLE_LIMIT = 12;
const EVENT_SAMPLE_LIMIT = 8;
/** One year forward: every yearly birthday falls in the window exactly once. */
const PROBE_WINDOW_DAYS = 365;

/**
 * Dumps what the device calendars actually are, because the SDK types cannot say.
 *
 * Three questions, none answerable off a device, all of which decide the shape of the
 * calendar adapter:
 *
 * 1. **How is the birthday calendar identified?** `Calendar.type === 'birthdays'` is the
 *    clean discriminator and it is **iOS only** — the field is absent on Android. Android
 *    instead carries `name`, `ownerAccount` and `source.{name,type}`, so the fork is over
 *    *what identifies a calendar*, exactly as `contacts.ts` forks over what identifies a
 *    birthday. Matching the display title is the wrong answer on both platforms: it is the
 *    user's locale, not a stable key.
 * 2. **Is an event id stable between reads?** `externalId` is the whole de-duplication
 *    contract — `partitionCandidates` and `person_external_idx` both hang off it. Android
 *    documents `instanceId` as "volatile ... not guaranteed to always refer to the same
 *    instance", which is a warning about `id` too. So this reads the same window twice and
 *    compares, rather than trusting either field's doc comment.
 * 3. **What does it yield?** The address book gave 0 birthdays across 433 contacts. If the
 *    calendars give none either, that is a fact about the funnel, not about this code, and
 *    it re-ranks the remaining steps.
 *
 * Every field is read by name rather than spread or `JSON.stringify`-ed whole: these are
 * native shared objects, and stringifying one prints `{}` while looking like it worked.
 */
async function probeCalendars(): Promise<string> {
  // Dynamic, not a module-scope import. `requireNativeModule('CalendarNext')` runs when
  // `expo-calendar` is first evaluated, so a dev build without the native module throws
  // there — and a module-scope import would put that throw in the path of every route that
  // reaches this panel, which is the same shape as the `expo-notifications` crash recorded
  // in AGENTS.md even though the cause differs. Inside the probe it costs one status line.
  // (Expo Go is the benign case: the module substitutes a stub whose methods throw, so the
  // import itself survives and only the calls below fail.)
  const Calendar = await import('expo-calendar');

  const permission = await Calendar.requestCalendarPermissions();
  if (!permission.granted) {
    // A refusal and a missing manifest permission are the same result here: Android denies
    // an undeclared permission with no prompt at all. `READ_CALENDAR` reaches the manifest
    // because Expo auto-applies an autolinked module's config plugin — `app.json` naming
    // `expo-calendar` only overrides the iOS copy — so a build carrying the package carries
    // the permission. **No prompt at all** therefore means the build predates the package,
    // not that the plugin entry is missing.
    return [
      `Permission not granted (status: ${permission.status}, canAskAgain: ${permission.canAskAgain}).`,
      'A system prompt you dismissed is a refusal. No prompt at all means this build has no',
      'READ_CALENDAR — check expo-calendar was installed when it was built.',
    ].join('\n');
  }

  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  if (calendars.length === 0) {
    return `${Platform.OS}: permission granted, zero event calendars. Nothing to import from.`;
  }

  const from = new Date();
  const to = new Date(from.getTime() + PROBE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const ids = calendars.map((calendar) => calendar.id);

  const events = await Calendar.listEvents(ids, from, to);
  // The same window, read again. If these ids disagree, `externalId` cannot be an event id
  // and the adapter needs a synthetic key — which is a design decision, not a detail.
  const secondRead = await Calendar.listEvents(ids, from, to);

  const perCalendar = new Map<string, number>();
  for (const event of events) {
    perCalendar.set(event.calendarId, (perCalendar.get(event.calendarId) ?? 0) + 1);
  }

  const calendarLines = calendars.slice(0, CALENDAR_SAMPLE_LIMIT).map((calendar) => {
    const identity = [
      `  id=${JSON.stringify(calendar.id)}`,
      `  title=${JSON.stringify(calendar.title)}`,
      // iOS only. Its absence here is the whole reason Android needs the fields below.
      `  type=${JSON.stringify(calendar.type ?? null)}`,
      `  name=${JSON.stringify(calendar.name ?? null)}`,
      `  ownerAccount=${JSON.stringify(calendar.ownerAccount ?? null)}`,
      `  source.name=${JSON.stringify(calendar.source?.name ?? null)}`,
      `  source.type=${JSON.stringify(calendar.source?.type ?? null)}`,
      `  allowsModifications=${calendar.allowsModifications}`,
      `  isPrimary=${JSON.stringify(calendar.isPrimary ?? null)}`,
      `  isVisible=${JSON.stringify(calendar.isVisible ?? null)}`,
      `  events in window=${perCalendar.get(calendar.id) ?? 0}`,
    ].join('\n');
    return `${calendar.title}\n${identity}`;
  });

  // Sampled from the calendar carrying the most events, which on a phone with a birthdays
  // calendar is overwhelmingly likely to be it — and if it is not, the counts above say so.
  const busiest = [...perCalendar.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const eventLines = events
    .filter((event) => event.calendarId === busiest)
    .slice(0, EVENT_SAMPLE_LIMIT)
    .map((event) =>
      [
        `  title=${JSON.stringify(event.title)}`,
        `    id=${JSON.stringify(event.id)}`,
        // Android only, and documented as volatile. Printed so the second-read comparison
        // below can be read against something concrete.
        `    instanceId=${JSON.stringify(event.instanceId ?? null)}`,
        `    startDate=${formatProbeDate(event.startDate)}`,
        `    allDay=${event.allDay}`,
        `    recurrenceRule=${JSON.stringify(event.recurrenceRule)}`,
      ].join('\n'),
    );

  // Sorted, because the question is whether the *set* of ids survived a second read. Two
  // reads returning the same ids in a different order is not instability, and comparing them
  // in arrival order would report it as such.
  const firstIds = events
    .map((event) => event.id)
    .sort()
    .join('|');
  const secondIds = secondRead
    .map((event) => event.id)
    .sort()
    .join('|');

  return [
    `${Platform.OS}, permission: ${permission.status}`,
    `${calendars.length} event calendars, ${events.length} events in ${PROBE_WINDOW_DAYS} days`,
    `ids stable across two reads: ${firstIds === secondIds ? 'YES' : 'NO — event id cannot be externalId'}`,
    '',
    ...calendarLines,
    '',
    events.length > 0 ? 'Sample from the busiest calendar:' : 'No events in the window.',
    ...eventLines,
  ].join('\n');
}

/** `startDate` is typed `string | Date` and the platforms disagree about which. */
function formatProbeDate(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two, paddingTop: Spacing.three },
});
