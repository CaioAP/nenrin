import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  deleteGroup,
  renameGroup,
  setGroupLeadDays,
  setGroupMember,
  setGroupTone,
} from '@/db/groups';
import { useGroups, usePeople, useSettings } from '@/db/hooks';
import { formatBirthday } from '@/domain/format';
import type { Group } from '@/domain/group';
import { TONE_CHOICES } from '@/domain/message';
import type { Person } from '@/domain/person';
import { describeLeadDays, LEAD_DAY_CHOICES } from '@/domain/settings';
import { useTheme } from '@/hooks/use-theme';

/**
 * One group: its name, the two defaults it gives its members, and who those members are.
 *
 * Every control writes straight through, like Settings. The defaults change reminders the
 * moment they land, so a Save button would only add a way to lose the change. The name is
 * the exception, written when the field is left, because a half-typed name is not a name.
 *
 * Membership is chosen from everyone, here, rather than only on each person's screen —
 * putting fifteen colleagues into Work one person at a time is fifteen round trips.
 */
export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { groups, loading, error } = useGroups();
  const group = groups.find((candidate) => candidate.id === id) ?? null;

  if (error) return <Centred title="Something went wrong" body={error.message} />;
  if (loading) return null;
  if (!group) return <Centred title="Not here" body="This group has been removed." />;

  return <GroupEditor group={group} />;
}

function GroupEditor({ group }: { group: Group }) {
  const theme = useTheme();
  const { settings } = useSettings();
  const { people } = usePeople();
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === ''
      ? people
      : people.filter((person) => person.displayName.toLowerCase().includes(needle));
  }, [people, query]);

  const confirmDelete = () => {
    Alert.alert(
      `Remove ${group.name}?`,
      'Everyone in it stays. They go back to the app’s default reminder and tone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteGroup(group.id);
            router.back();
          },
        },
      ],
    );
  };

  const header = (
    <View style={styles.header}>
      <GroupName group={group} />

      <Section
        title="Remind me"
        hint="For everyone in this group. Someone in two groups gets the earlier of the two."
      >
        <Chip
          label={`App default (${describeLeadDays(settings.defaultLeadDays).toLowerCase()})`}
          selected={group.leadDays === null}
          onPress={() => setGroupLeadDays(group.id, null)}
        />
        {LEAD_DAY_CHOICES.map((days) => (
          <Chip
            key={days}
            label={describeLeadDays(days)}
            selected={group.leadDays === days}
            onPress={() => setGroupLeadDays(group.id, days)}
          />
        ))}
      </Section>

      <Section
        title="Message tone"
        hint="Where suggested messages start, for anyone you have not picked a tone for. Someone whose groups disagree starts on Close."
      >
        <Chip
          label="No preference"
          selected={group.tone === null}
          onPress={() => setGroupTone(group.id, null)}
        />
        {TONE_CHOICES.map(({ value, label }) => (
          <Chip
            key={value}
            label={label}
            selected={group.tone === value}
            onPress={() => setGroupTone(group.id, value)}
            accessibilityLabel={`${label} tone`}
          />
        ))}
      </Section>

      <View style={styles.section}>
        <ThemedText type="smallBold">
          People ({group.memberIds.size} of {people.length})
        </ThemedText>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={theme.textSecondary}
          autoCorrect={false}
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: group.name,
          headerRight: () => (
            <Pressable
              onPress={confirmDelete}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${group.name}`}
              hitSlop={Spacing.two}
              style={[styles.delete, { backgroundColor: theme.danger }]}
            >
              <Ionicons name="trash" size={18} color={theme.background} />
            </Pressable>
          ),
        }}
      />
      <ThemedView style={styles.container}>
        <FlatList
          data={matches}
          keyExtractor={(person) => person.id}
          // An element, not a component: a component defined in render would remount on every
          // keystroke and take the keyboard down with the focused field.
          ListHeaderComponent={header}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary">
              {people.length === 0 ? 'Nobody to add yet.' : `Nobody is called “${query.trim()}”.`}
            </ThemedText>
          }
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <MemberRow
              person={item}
              member={group.memberIds.has(item.id)}
              onToggle={(member) => setGroupMember(group.id, item.id, member)}
            />
          )}
        />
      </ThemedView>
    </>
  );
}

/**
 * The group's name, renamed when the field is left.
 *
 * Re-seeded only when the stored name changes, so a rejected rename stays on screen beside
 * its reason instead of snapping back before it can be read.
 */
function GroupName({ group }: { group: Group }) {
  const theme = useTheme();
  const [draft, setDraft] = useState(group.name);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setDraft(group.name);
  }, [group.name]);

  const commit = async () => {
    if (draft === group.name) return setProblem(null);
    const result = await renameGroup(group.id, draft);
    setProblem(result.ok ? null : result.error);
  };

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Name</ThemedText>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onEndEditing={commit}
        returnKeyType="done"
        accessibilityLabel="Group name"
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
      />
      {problem ? (
        <ThemedText type="small" accessibilityRole="alert" themeColor="danger">
          {problem}
        </ThemedText>
      ) : null}
    </View>
  );
}

function MemberRow({
  person,
  member,
  onToggle,
}: {
  person: Person;
  member: boolean;
  onToggle: (member: boolean) => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => onToggle(!member)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: member }}
      style={styles.row}
    >
      <Ionicons
        name={member ? 'checkmark-circle' : 'ellipse-outline'}
        size={24}
        color={member ? theme.tint : theme.textSecondary}
      />
      <View style={styles.rowText}>
        <ThemedText type="default">{person.displayName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatBirthday(person.birthday)}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {hint}
      </ThemedText>
      <View style={styles.choices}>{children}</View>
    </View>
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
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  header: { gap: Spacing.four, paddingBottom: Spacing.two },
  section: { gap: Spacing.two },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  search: {
    minHeight: 44,
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  rowText: { flex: 1, gap: Spacing.half },
  delete: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: Spacing.two,
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
