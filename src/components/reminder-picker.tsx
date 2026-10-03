import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import type { InheritedLead } from '@/domain/person';
import { describeLeadDays, LEAD_DAY_CHOICES } from '@/domain/settings';
import { Chip } from './chip';
import { ThemedText } from './themed-text';

export type ReminderChoice = {
  /** The person's own lead time. Null inherits from their groups or the app default. */
  leadDays: number | null;
  muted: boolean;
};

/**
 * When to be reminded about one person, including not at all.
 *
 * Muting is one more chip in the same row rather than a separate switch, because the two are
 * one question — "when should I hear about them?" — and "never" is an answer to it. Off
 * leaves the stored lead time alone; un-muting is picking a lead again.
 *
 * Form state, like the group picker: nothing is written until the person is saved.
 */
export function ReminderPicker({
  value,
  inherited,
  onChange,
}: {
  value: ReminderChoice;
  inherited: InheritedLead;
  onChange: (next: ReminderChoice) => void;
}) {
  // A lead time outside the chips cannot be set from this screen today, but if one is ever
  // stored it must still show as selected rather than leave the row looking unset.
  const choices: number[] = [...LEAD_DAY_CHOICES];
  if (value.leadDays !== null && !choices.includes(value.leadDays)) {
    choices.push(value.leadDays);
    choices.sort((a, b) => a - b);
  }

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">Remind me</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {value.muted
          ? 'No reminders for them. They stay in your list and your calendar.'
          : value.leadDays === null
            ? inherited.fromGroup === null
              ? 'Default comes from Settings.'
              : `Default comes from ${inherited.fromGroup}.`
            : 'Just for them, whatever their groups say.'}
      </ThemedText>
      <View style={styles.choices}>
        <Chip
          label={`Default (${describeLeadDays(inherited.days).toLowerCase()})`}
          selected={!value.muted && value.leadDays === null}
          onPress={() => onChange({ leadDays: null, muted: false })}
        />
        {choices.map((days) => (
          <Chip
            key={days}
            label={describeLeadDays(days)}
            selected={!value.muted && value.leadDays === days}
            onPress={() => onChange({ leadDays: days, muted: false })}
          />
        ))}
        <Chip
          label="Off"
          selected={value.muted}
          accessibilityLabel="No reminders"
          onPress={() => onChange({ ...value, muted: true })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
