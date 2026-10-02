import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useCalendarExport } from '@/db/hooks';
import { EXPORT_CALENDAR_TITLE } from '@/export/calendar';
import { disableCalendarExport, enableCalendarExport, type SyncOutcome } from '@/export/sync';
import { ActionButton } from './action-button';
import { ThemedText } from './themed-text';

type Notice = { text: string; openSettings?: boolean };

/**
 * The switch for showing birthdays in the device calendar.
 *
 * A button per state rather than a toggle, because both directions do real work the person
 * should see finish: turning it on asks for calendar access and writes every birthday,
 * turning it off deletes a calendar. A toggle that flipped instantly would claim both had
 * happened before either had.
 */
export function CalendarExportSection() {
  const { state, exportedCount } = useCalendarExport();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const run = async (action: () => Promise<Notice | null>) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (cause) {
      setNotice({
        text: cause instanceof Error ? cause.message : 'Could not reach your calendar.',
      });
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () => run(async () => noticeFor(await enableCalendarExport()));
  const turnOff = () =>
    run(async () => {
      await disableCalendarExport();
      return null;
    });

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Calendar</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {state.enabled
          ? `Every birthday is in a calendar called “${EXPORT_CALENDAR_TITLE}” (${exportedCount} ${exportedCount === 1 ? 'event' : 'events'}), and stays in step as you add and edit people.`
          : `Show every birthday as a yearly all-day event, in a calendar of its own called “${EXPORT_CALENDAR_TITLE}”.`}
      </ThemedText>
      <View style={styles.actions}>
        {state.enabled ? (
          <ActionButton label="Remove from my calendar" onPress={turnOff} disabled={busy} />
        ) : (
          <ActionButton label="Add to my calendar" onPress={turnOn} disabled={busy} />
        )}
      </View>
      {notice ? (
        <>
          <ThemedText type="small" accessibilityRole="alert" themeColor="textSecondary">
            {notice.text}
          </ThemedText>
          {notice.openSettings ? (
            <View style={styles.actions}>
              <ActionButton label="Open system settings" onPress={() => Linking.openSettings()} />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** What to tell the person after they turned export on. Null when the state says it all. */
function noticeFor(outcome: SyncOutcome): Notice | null {
  switch (outcome.kind) {
    case 'synced':
      return null;
    case 'denied':
      return {
        text: 'Nenrin is not allowed to use your calendars, so it cannot add birthdays there.',
        openSettings: true,
      };
    // Neither can follow a fresh enable — it creates the calendar and switches export on —
    // but the type has them, and a silent `default` would hide a new case added later.
    case 'calendar-removed':
    case 'off':
      return { text: 'The calendar could not be created. Try again.' };
  }
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
