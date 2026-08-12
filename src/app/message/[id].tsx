import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePerson } from '@/db/hooks';
import { setTone } from '@/db/people';
import { ageAtNextOccurrence } from '@/domain/birthday';
import { DEFAULT_TONE, type MessageOption, messageOptions, type Tone } from '@/domain/message';
import { useTheme } from '@/hooks/use-theme';

const TONES: { value: Tone; label: string }[] = [
  { value: 'family', label: 'Family' },
  { value: 'close', label: 'Close' },
  { value: 'colleague', label: 'Colleague' },
];

/**
 * Suggested messages for one person: pick one, edit it, copy or share it.
 *
 * The point is not to write the greeting for you — it is to remove the pause where you do
 * not know how to open, put it off, and let the day end.
 *
 * Tone is not local state. It lives on the person, so tapping a chip is a write and the new
 * value arrives back through the live query — which is also what resets the selection.
 */
export default function MessageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { person, loading, error } = usePerson(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const theme = useTheme();

  const tone = person?.tone ?? DEFAULT_TONE;

  // Switching tone throws away the current selection and any edits. Keeping them would mean
  // per-template edit memory or a confirm dialog, both of which cost more than a screen you
  // use for ten seconds a year is worth.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the tone changes
  useEffect(() => {
    setSelectedId(null);
    setText('');
    setStatus(null);
  }, [tone]);

  if (error) return <Centred title="Something went wrong" body={error.message} />;
  if (loading) return null;
  if (!person) return <Centred title="Not here" body="This person has been removed." />;

  const options = messageOptions({
    displayName: person.displayName,
    age: ageAtNextOccurrence(person.birthday, new Date()),
    tone,
  });

  const choose = (option: MessageOption) => {
    setSelectedId(option.id);
    setText(option.text);
    setStatus(null);
  };

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      setStatus('Copied.');
    } catch {
      // Nothing the user can act on, and an alert over a birthday message is worse than
      // the failure. The text is still on screen and still selectable.
      setStatus('Could not copy. Select the text and copy it by hand.');
    }
  };

  const share = async () => {
    try {
      await Share.share({ message: text });
    } catch {
      setStatus('Could not open the share sheet.');
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: person.displayName }} />
      <ThemedView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.tones}>
            {TONES.map(({ value, label }) => (
              <Chip
                key={value}
                label={label}
                selected={value === tone}
                onPress={() => setTone(person.id, value)}
                accessibilityLabel={`${label} tone`}
              />
            ))}
          </View>

          {options.length === 0 ? (
            <ThemedText themeColor="textSecondary">
              Every message for this tone needs an age, and {person.displayName}'s birth year is
              unknown. Add a year, or pick another tone.
            </ThemedText>
          ) : (
            options.map((option) => (
              <Suggestion
                key={option.id}
                text={option.text}
                selected={option.id === selectedId}
                onPress={() => choose(option)}
              />
            ))
          )}

          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Pick one above, or write your own"
            placeholderTextColor={theme.textSecondary}
            style={[styles.editor, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />

          <View style={styles.actions}>
            <ActionButton label="Copy" onPress={copy} disabled={text.trim().length === 0} />
            <ActionButton label="Share" onPress={share} disabled={text.trim().length === 0} />
          </View>

          {status ? (
            <ThemedText type="small" themeColor="textSecondary">
              {status}
            </ThemedText>
          ) : null}
        </ScrollView>
      </ThemedView>
    </>
  );
}

function Suggestion({
  text,
  selected,
  onPress,
}: {
  text: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[
        styles.suggestion,
        {
          backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
        },
      ]}
    >
      <ThemedText>{text}</ThemedText>
    </Pressable>
  );
}

function Centred({ title, body }: { title: string; body: string }) {
  return (
    <ThemedView style={styles.centred}>
      <ThemedText type="subtitle">{title}</ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.centredText}>
        {body}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  tones: { flexDirection: 'row', gap: Spacing.two },
  suggestion: {
    minHeight: 44,
    justifyContent: 'center',
    padding: Spacing.three,
    borderRadius: 4,
  },
  editor: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 4,
    padding: Spacing.three,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: Spacing.two },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  centredText: { textAlign: 'center' },
});
