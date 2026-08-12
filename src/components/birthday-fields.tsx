import { useMemo, useRef } from 'react';
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
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    [daysInMonth],
  );
  const months = useMemo(
    () => MONTH_NAMES.map((name, index) => ({ value: index + 1, label: name.slice(0, 3) })),
    [],
  );

  const selectMonth = (month: number) => {
    const keepsDay = value.day !== null && isValidMonthDay(month, value.day);
    onChange({ ...value, month, day: keepsDay ? value.day : null });
  };

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">Month</ThemedText>
      <ChipRow options={months} selected={value.month} onSelect={selectMonth} />

      <ThemedText type="smallBold">Day</ThemedText>
      <ChipRow
        options={days}
        selected={value.day}
        onSelect={(day) => onChange({ ...value, day })}
      />

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

/**
 * A horizontal chip row that reveals its selection on open.
 *
 * November, or the 25th, starts well off the right edge, so an edit screen would open on a
 * row that looks like nothing is chosen. The offset cannot be computed — a chip is as wide
 * as its label, so 1 and 25 are different sizes — so the selected chip reports its own `x`
 * and the row scrolls there once.
 */
function ChipRow({
  options,
  selected,
  onSelect,
}: {
  options: { value: number; label: string }[];
  selected: number | null;
  onSelect: (value: number) => void;
}) {
  const scroll = useRef<ScrollView>(null);
  const selectedX = useRef<number | null>(null);
  const revealed = useRef(false);

  // One-shot: after this, the row is the user's to scroll. Re-running it on every selection
  // would yank the row out from under a finger mid-scroll.
  const reveal = () => {
    if (revealed.current || selectedX.current === null) return;
    revealed.current = true;
    scroll.current?.scrollTo({
      x: Math.max(0, selectedX.current - Spacing.three),
      animated: false,
    });
  };

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      // A `scrollTo` fired from the chip's own `onLayout` can arrive before the row knows its
      // content size, and Android drops it with no error. Trying again once the size is known
      // costs nothing, and the latch keeps it to a single jump either way.
      onContentSizeChange={reveal}
    >
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          selected={selected === option.value}
          onPress={() => onSelect(option.value)}
          onLayout={
            selected === option.value
              ? (event) => {
                  selectedX.current = event.nativeEvent.layout.x;
                  reveal();
                }
              : undefined
          }
        />
      ))}
    </ScrollView>
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
