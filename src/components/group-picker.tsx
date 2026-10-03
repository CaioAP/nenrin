import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import type { Group } from '@/domain/group';
import { Chip } from './chip';
import { ThemedText } from './themed-text';

/**
 * Which groups a person is in, as a row of toggles.
 *
 * Chips rather than a list of checkboxes, because a typical install has three to six groups
 * and all of them fit on screen at once. The selection is the form's state, not a write:
 * it is saved with the rest of the person, so Cancel still means cancel.
 */
export function GroupPicker({
  groups,
  selected,
  onChange,
}: {
  groups: readonly Group[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">Groups</ThemedText>
      {groups.length === 0 ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            None yet. A group like Family or Work sets the reminder for everyone in it at once.
          </ThemedText>
          <Link href="/groups" accessibilityRole="link">
            <ThemedText type="smallBold" themeColor="tint">
              Make a group
            </ThemedText>
          </Link>
        </>
      ) : (
        <View style={styles.choices}>
          {groups.map((group) => (
            <Chip
              key={group.id}
              label={group.name}
              selected={selected.has(group.id)}
              onPress={() => toggle(group.id)}
              accessibilityLabel={`In ${group.name}`}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
