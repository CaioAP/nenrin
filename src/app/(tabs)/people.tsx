import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePeople } from '@/db/hooks';
import { formatBirthday } from '@/domain/format';
import type { Person } from '@/domain/person';
import { useTheme } from '@/hooks/use-theme';

export default function PeopleScreen() {
  const theme = useTheme();
  const { people, loading, error } = usePeople();
  const [query, setQuery] = useState('');

  const matches = useMemo(() => filterPeople(people, query), [people, query]);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={theme.textSecondary}
          autoCorrect={false}
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <Link href="/person/new" asChild>
          {/* Flattened, not an array: `asChild` clones this into expo-router's <Slot>, which
              rejects an array style at runtime. The two list rows below get away with a bare
              `styles.row` because a single registered style is not an array. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a person"
            style={StyleSheet.flatten([styles.add, { backgroundColor: theme.backgroundSelected }])}
          >
            <ThemedText type="subtitle">+</ThemedText>
          </Pressable>
        </Link>
      </View>

      {error ? (
        <Centred title="Something went wrong" body={error.message} />
      ) : loading ? null : people.length === 0 ? (
        <Centred title="Nobody yet" body="Tap + to add the first birthday you know by heart." />
      ) : matches.length === 0 ? (
        <Centred title="No matches" body={`Nobody here is called “${query.trim()}”.`} />
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(person) => person.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <PersonRow person={item} />}
        />
      )}
    </ThemedView>
  );
}

function PersonRow({ person }: { person: Person }) {
  return (
    // Pressable, not View: `asChild` clones the child and injects `onPress`, and a View
    // silently drops it — leaving a row that announces itself as a button and does nothing.
    <Link href={`/person/${person.id}`} asChild>
      <Pressable style={styles.row} accessibilityRole="button">
        <ThemedText type="default">{person.displayName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatBirthday(person.birthday)}
        </ThemedText>
      </Pressable>
    </Link>
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

/** Case-insensitive substring match on the name. */
function filterPeople(people: Person[], query: string): Person[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return people;
  return people.filter((person) => person.displayName.toLowerCase().includes(needle));
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    gap: Spacing.two,
    padding: Spacing.three,
    alignItems: 'center',
  },
  search: {
    flex: 1,
    minHeight: 44,
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  add: {
    width: 44,
    height: 44,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  row: { minHeight: 44, justifyContent: 'center', gap: Spacing.half, paddingVertical: Spacing.two },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  centredText: { textAlign: 'center' },
});
