import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';

import { PersonForm } from '@/components/person-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePerson } from '@/db/hooks';
import { deletePerson, updatePerson } from '@/db/people';
import {
  draftFromPerson,
  EMPTY_PERSON_DRAFT,
  type PersonDraft,
  parsePersonDraft,
} from '@/domain/draft';
import { useTheme } from '@/hooks/use-theme';

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { person, loading, error } = usePerson(id);
  const [draft, setDraft] = useState<PersonDraft>(EMPTY_PERSON_DRAFT);
  const [ready, setReady] = useState(false);

  // Seeded once. Re-seeding on every change to `person` would fight the user's typing, since
  // the live query re-fires the moment they save.
  useEffect(() => {
    if (person && !ready) {
      setDraft(draftFromPerson(person));
      setReady(true);
    }
  }, [person, ready]);

  const save = async () => {
    const parsed = parsePersonDraft(draft, new Date().getFullYear());
    if (!parsed.ok) return parsed.errors;

    await updatePerson(id, {
      displayName: parsed.value.displayName,
      birthday: parsed.value.birthday,
      notes: parsed.value.notes,
    });
    router.back();
    return null;
  };

  const confirmDelete = () => {
    Alert.alert('Remove this person?', 'Their birthday will no longer be tracked.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deletePerson(id);
          router.back();
        },
      },
    ]);
  };

  if (error) return <Centred title="Something went wrong" body={error.message} />;
  if (loading) return null;
  if (!person) {
    return <Centred title="Not here" body="This person has been removed." />;
  }
  // Gated on `ready`, not `loading`: the draft is seeded by an effect that runs *after* the
  // first render with a loaded person, so rendering here would paint one frame of an empty
  // form.
  if (!ready) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: person.displayName,
          headerRight: () => (
            <Pressable
              onPress={confirmDelete}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${person.displayName}`}
              // The box is small enough to sit in a header without crowding the title, so the
              // 44pt touch target comes from hitSlop rather than from its size.
              hitSlop={Spacing.two}
              style={[styles.delete, { backgroundColor: theme.danger }]}
            >
              {/* `background`, not a fixed white: dark mode's danger is a pale pink, and white
                  on it is unreadable. Same rule as `onTint` — pick the colour that passes. */}
              <Ionicons name="trash" size={18} color={theme.background} />
            </Pressable>
          ),
        }}
      />
      <PersonForm
        draft={draft}
        onChange={setDraft}
        onSubmit={save}
        submitLabel="Save changes"
        footer={
          <Link href={`/message/${id}`} asChild>
            {/* Flattened, not an array: `asChild` clones this into expo-router's <Slot>,
                which rejects an array style at runtime. */}
            <Pressable
              accessibilityRole="button"
              style={StyleSheet.flatten([styles.outlined, { borderColor: theme.tint }])}
            >
              <ThemedText type="smallBold" themeColor="tint">
                Write a message
              </ThemedText>
            </Pressable>
          </Link>
        }
      />
    </>
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
  delete: {
    width: 32,
    height: 32,
    borderRadius: 8,
    // Android's header puts nothing between headerRight and the screen edge.
    marginRight: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlined: {
    minHeight: 44,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  centredText: { textAlign: 'center' },
});
