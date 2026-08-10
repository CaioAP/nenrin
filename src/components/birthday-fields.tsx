import { useMemo } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { isValidMonthDay } from '@/domain/birthday';
import { MONTH_NAMES } from '@/domain/format';
import { useTheme } from '@/hooks/use-theme';
import { Chip } from './chip';
import { ThemedText } from './themed-text';

export type BirthdayDraft = {
  month: number | null;
  day: number | null;
  /** Empty string means "I don't know the year", which is the common case. */
  year: string;
};

export const EMPTY_BIRTHDAY: BirthdayDraft = { month: null, day: null, year: '' };

/**
 * Month, day, and an optional year.
 *
 * The year is a separate, clearly optional field rather than part of a single date picker.
 * A native date picker forces a year to be chosen, and most birthdays you know are day and
 * month only — a picker would make people invent a year or give up, which is exactly the
 * entry friction this app exists to remove.
 */
export function BirthdayFields({
  value,
  onChange,
}: {
  value: BirthdayDraft;
  onChange: (next: BirthdayDraft) => void;
}) {
  const theme = useTheme();

  // Days available depend on the month, and February offers 29 so leap-day birthdays are
  // enterable. A day already chosen that the new month cannot hold is cleared rather than
  // silently coerced to the 28th.
  const daysInMonth = value.month === null ? 31 : value.month === 2 ? 29 : monthLength(value.month);
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

  const selectMonth = (month: number) => {
    const keepsDay = value.day !== null && isValidMonthDay(month, value.day);
    onChange({ ...value, month, day: keepsDay ? value.day : null });
  };

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">Month</ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {MONTH_NAMES.map((name, index) => (
          <Chip
            key={name}
            label={name.slice(0, 3)}
            selected={value.month === index + 1}
            onPress={() => selectMonth(index + 1)}
          />
        ))}
      </ScrollView>

      <ThemedText type="smallBold">Day</ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {days.map((day) => (
          <Chip
            key={day}
            label={String(day)}
            selected={value.day === day}
            onPress={() => onChange({ ...value, day })}
          />
        ))}
      </ScrollView>

      <ThemedText type="smallBold">Year (optional)</ThemedText>
      <TextInput
        value={value.year}
        onChangeText={(year) => onChange({ ...value, year: year.replace(/\D/g, '').slice(0, 4) })}
        placeholder="Leave blank if you don’t know"
        placeholderTextColor={theme.textSecondary}
        keyboardType="number-pad"
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Without a year the birthday still works — you just won’t see an age.
      </ThemedText>
    </View>
  );
}

const monthLength = (month: number) => [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  row: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
