import { Link } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePeople } from '@/db/hooks';
import { formatOccursOn, formatTurningAge } from '@/domain/format';
import { describeDaysAway, type UpcomingEntry, upcoming } from '@/domain/upcoming';

export default function UpcomingScreen() {
  const { people, loading, error } = usePeople();

  // `new Date()` is read once per render rather than inside the sort, so every row in a
  // single list agrees on what "today" is.
  //
  // Known limitation: the memo is keyed on `people`, so a list left open across midnight
  // keeps saying "Tomorrow" for a birthday that is now today. Re-running on app foreground
  // fixes it, and is worth doing when the notification re-arming lands — the two want the
  // same trigger.
  const entries = useMemo(() => upcoming(people, new Date()), [people]);

  if (error) return <Message title="Something went wrong" body={error.message} />;
  if (loading) return null;

  if (entries.length === 0) {
    return (
      <Message
        title="No birthdays yet"
        body="Add someone and they will show up here, soonest first."
      />
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.person.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <UpcomingRow entry={item} />}
      />
    </ThemedView>
  );
}

function UpcomingRow({ entry }: { entry: UpcomingEntry }) {
  const age = formatTurningAge(entry.turningAge);

  return (
    // Pressable, not View: `asChild` clones the child and injects `onPress`, and a View
    // silently drops it — leaving a row that announces itself as a button and does nothing.
    <Link href={`/person/${entry.person.id}`} asChild>
      <Pressable style={styles.row} accessibilityRole="button">
        <View style={styles.rowMain}>
          <ThemedText type="default">{entry.person.displayName}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatOccursOn(entry.occursOn)}
            {age ? ` · ${age}` : ''}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" themeColor={entry.daysAway === 0 ? 'text' : 'textSecondary'}>
          {describeDaysAway(entry.daysAway)}
        </ThemedText>
      </Pressable>
    </Link>
  );
}

function Message({ title, body }: { title: string; body: string }) {
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
  container: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 44,
    paddingVertical: Spacing.two,
  },
  rowMain: { flex: 1, gap: Spacing.half },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  centredText: { textAlign: 'center' },
});
