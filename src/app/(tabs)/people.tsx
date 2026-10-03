import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useGroups, usePeople } from '@/db/hooks';
import { formatBirthday } from '@/domain/format';
import type { Group } from '@/domain/group';
import type { Person } from '@/domain/person';
import { useTheme } from '@/hooks/use-theme';

export default function PeopleScreen() {
  const theme = useTheme();
  const { people, loading, error } = usePeople();
  const { groups } = useGroups();
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);

  // Looked up rather than stored, so a group removed while it was selected falls back to
  // everyone instead of filtering on a group that no longer exists.
  const selectedGroup = groups.find((group) => group.id === groupId) ?? null;

  const matches = useMemo(
    () => filterPeople(people, query, selectedGroup),
    [people, query, selectedGroup],
  );

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
            style={StyleSheet.flatten([styles.add, { backgroundColor: theme.tint }])}
          >
            <ThemedText type="subtitle" themeColor="onTint">
              +
            </ThemedText>
          </Pressable>
        </Link>
      </View>

      {groups.length > 0 && people.length > 0 ? (
        // Scrolls rather than wraps, unlike Settings: this sits above the list, and a wrapped
        // block of chips would push the people it filters off the screen.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          style={styles.filterBar}
        >
          <Chip
            label="Everyone"
            selected={selectedGroup === null}
            onPress={() => setGroupId(null)}
          />
          {groups.map((group) => (
            <Chip
              key={group.id}
              label={group.name}
              selected={selectedGroup?.id === group.id}
              onPress={() => setGroupId(group.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      {error ? (
        <Centred title="Something went wrong" body={error.message} />
      ) : loading ? null : people.length === 0 ? (
        <Centred title="Nobody yet" body="Tap + to add the first birthday you know by heart." />
      ) : matches.length === 0 ? (
        selectedGroup !== null && query.trim() === '' ? (
          <Centred
            title={`Nobody in ${selectedGroup.name}`}
            body="Add people to it from their own page, or from the group in Settings."
          />
        ) : (
          <Centred title="No matches" body={`Nobody here is called “${query.trim()}”.`} />
        )
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

/** Case-insensitive substring match on the name, within the selected group if there is one. */
function filterPeople(people: Person[], query: string, group: Group | null): Person[] {
  const needle = query.trim().toLowerCase();
  return people.filter(
    (person) =>
      (group === null || group.memberIds.has(person.id)) &&
      (needle === '' || person.displayName.toLowerCase().includes(needle)),
  );
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
  filterBar: { flexGrow: 0 },
  filters: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
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
