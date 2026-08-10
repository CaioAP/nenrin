import { Pressable, StyleSheet } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from './themed-text';

/**
 * A filled button sized to its label.
 *
 * Distinct from the form submit button, which stretches to the full width of the form. This
 * one sits inline in a section and should not look like the primary action of the screen.
 */
export function ActionButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[styles.button, { backgroundColor: theme.tint, opacity: disabled ? 0.6 : 1 }]}
    >
      <ThemedText type="smallBold" themeColor="onTint">
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
});
