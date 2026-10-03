import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { createGroup } from '@/db/groups';
import { useGroups } from '@/db/hooks';
import { type Group, parseGroupName, suggestedGroupNames } from '@/domain/group';
import { TONE_CHOICES } from '@/domain/message';
import { describeLeadDays } from '@/domain/settings';
import { useTheme } from '@/hooks/use-theme';

/**
 * Every group, and the way to make another.
 *
 * Making one is a name and nothing else, and stays on this screen so the three suggestions
 * can be taken in three taps. Its reminder, tone and members are set on the group's own
 * screen — asking for everything up front would make the common case, "I want a Family
 * group", a form.
 */
export default function GroupsScreen() {
  const theme = useTheme();
  const { groups, loading, error } = useGroups();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (raw: string) => {
    if (busy) return;
    // Checked here first so a clash is reported without a round trip; `createGroup` checks
    // again against what is in the table at the moment it writes.
    const parsed = parseGroupName(
      raw,
      groups.map((group) => group.name),
    );
    if (!parsed.ok) return setProblem(parsed.error);

    setBusy(true);
    try {
      const result = await createGroup(parsed.value);
      if (!result.ok) return setProblem(result.error);
      setName('');
      setProblem(null);
    } finally {
      setBusy(false);
    }
  };

  const suggestions = suggestedGroupNames(groups.map((group) => group.name));

  return (
    <>
      <Stack.Screen options={{ title: 'Groups' }} />
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="small" themeColor="textSecondary">
            A group sets how early to remind you, and how messages open, for everyone in it. Anyone
            with their own setting keeps it.
          </ThemedText>

          <View style={styles.section}>
            <View style={styles.addRow}>
              <TextInput
                value={name}
                onChangeText={(next) => {
                  setName(next);
                  setProblem(null);
                }}
                onSubmitEditing={() => add(name)}
                placeholder="New group"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
                accessibilityLabel="New group name"
                style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              />
              <ActionButton label="Add" onPress={() => add(name)} disabled={busy} />
            </View>
            {problem ? (
              <ThemedText type="small" accessibilityRole="alert" themeColor="danger">
                {problem}
              </ThemedText>
            ) : null}
            {suggestions.length > 0 ? (
              <View style={styles.choices}>
                {suggestions.map((suggestion) => (
                  <Chip
                    key={suggestion}
                    label={`+ ${suggestion}`}
                    selected={false}
                    onPress={() => add(suggestion)}
                    accessibilityLabel={`Add a ${suggestion} group`}
                  />
                ))}
              </View>
            ) : null}
          </View>

          {error ? (
            <ThemedText themeColor="danger">{error.message}</ThemedText>
          ) : loading ? null : groups.length === 0 ? (
            <ThemedText themeColor="textSecondary">No groups yet.</ThemedText>
          ) : (
            <View>
              {groups.map((group) => (
                <GroupRow key={group.id} group={group} />
              ))}
            </View>
          )}
        </ScrollView>
      </ThemedView>
    </>
  );
}

function GroupRow({ group }: { group: Group }) {
  const theme = useTheme();

  return (
    <Link href={`/groups/${group.id}`} asChild>
      <Pressable style={styles.row} accessibilityRole="button">
        <View style={styles.rowText}>
          <ThemedText type="default">{group.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {summarise(group)}
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </Pressable>
    </Link>
  );
}

/** "3 people · 1 week before · Family". Only what the group actually sets. */
function summarise(group: Group): string {
  const count = group.memberIds.size;
  const parts = [count === 1 ? '1 person' : `${count} people`];
  if (group.leadDays !== null) parts.push(describeLeadDays(group.leadDays));
  const tone = TONE_CHOICES.find((choice) => choice.value === group.tone);
  if (tone) parts.push(`${tone.label} tone`);
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  section: { gap: Spacing.two },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  rowText: { flex: 1, gap: Spacing.half },
});
