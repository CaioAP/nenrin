import { type LayoutChangeEvent, Pressable, StyleSheet } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from './themed-text';

/**
 * A single-choice pill.
 *
 * Used wherever the options are few and worth seeing at once — months, days, lead times,
 * notification hours. Preferred over a native picker throughout: a picker hides the choices
 * behind a tap and costs a modal, and none of these sets is long enough to need one.
 */
export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  onLayout,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  /** Reports the chip's position within its row, so a scrolling row can reveal a selection. */
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: selected ? theme.tint : theme.backgroundElement }]}
    >
      <ThemedText type="small" themeColor={selected ? 'onTint' : 'text'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    // 44pt minimum touch target — anything smaller is unusable while scrolling a long row.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: 4,
  },
});
