import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import type { DraftErrors, PersonDraft } from '@/domain/draft';
import { useTheme } from '@/hooks/use-theme';
import { BirthdayFields } from './birthday-fields';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

/**
 * The add/edit form. Shared by both screens so their validation and layout cannot drift.
 *
 * `onSubmit` returns the errors to show, or null on success. Keeping validation in the caller
 * (which calls `parsePersonDraft`) means this component never decides what is valid — it only
 * decides what that looks like.
 */
export function PersonForm({
  draft,
  onChange,
  onSubmit,
  submitLabel,
}: {
  draft: PersonDraft;
  onChange: (next: PersonDraft) => void;
  onSubmit: () => Promise<DraftErrors | null>;
  submitLabel: string;
}) {
  const theme = useTheme();
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      setErrors((await onSubmit()) ?? {});
    } finally {
      // Cleared even on failure, or a rejected save would leave the button dead forever.
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <ThemedText type="smallBold">Name</ThemedText>
          <TextInput
            value={draft.displayName}
            onChangeText={(displayName) => onChange({ ...draft, displayName })}
            placeholder="Who is it?"
            placeholderTextColor={theme.textSecondary}
            autoFocus
            style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
          <FieldError message={errors.displayName} />
        </View>

        <BirthdayFields
          value={{ month: draft.month, day: draft.day, year: draft.year }}
          onChange={(birthday) => onChange({ ...draft, ...birthday })}
        />
        <FieldError message={errors.birthday} />
        <FieldError message={errors.year} />

        <View style={styles.field}>
          <ThemedText type="smallBold">Notes (optional)</ThemedText>
          <TextInput
            value={draft.notes}
            onChangeText={(notes) => onChange({ ...draft, notes })}
            placeholder="Anything worth remembering"
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[
              styles.input,
              styles.multiline,
              { color: theme.text, borderColor: theme.backgroundSelected },
            ]}
          />
        </View>

        <Pressable
          onPress={submit}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          style={[styles.submit, { backgroundColor: theme.tint, opacity: saving ? 0.6 : 1 }]}
        >
          <ThemedText type="smallBold" themeColor="onTint">
            {saving ? 'Saving…' : submitLabel}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  // Marked as an alert so a screen reader announces it rather than leaving the user to
  // discover a red line they cannot see. The colour is themed rather than a fixed red,
  // because a single red that passes AA on white is 3.86:1 on black.
  return (
    <ThemedText type="small" accessibilityRole="alert" themeColor="danger">
      {message}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  field: { gap: Spacing.two },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  multiline: { minHeight: 88, paddingTop: Spacing.two, textAlignVertical: 'top' },
  submit: {
    minHeight: 44,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
