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

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
  // form — and fire `autoFocus` on a blank name field before the real values land.
  if (!ready) return null;

  return (
    <>
      <Stack.Screen options={{ title: person.displayName }} />
      <PersonForm draft={draft} onChange={setDraft} onSubmit={save} submitLabel="Save changes" />
      <ThemedView style={styles.footer}>
        <Link href={`/message/${id}`} asChild>
          <Pressable accessibilityRole="button" style={styles.action}>
            <ThemedText type="smallBold" themeColor="tint">
              Write a message
            </ThemedText>
          </Pressable>
        </Link>
        <Pressable onPress={confirmDelete} accessibilityRole="button" style={styles.remove}>
          <ThemedText type="small" themeColor="danger">
            Remove {person.displayName}
          </ThemedText>
        </Pressable>
      </ThemedView>
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
  footer: { padding: Spacing.three },
  action: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  remove: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  centredText: { textAlign: 'center' },
});
