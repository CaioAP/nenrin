import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';
import { isValidMonthDay } from '@/domain/birthday';
import type { PersonDraft } from '@/domain/draft';
import { MONTH_NAMES } from '@/domain/format';
import { resolveSwipe, type TriageAction } from '@/domain/triage';
import { useTheme } from '@/hooks/use-theme';
import { Chip } from './chip';
import { ThemedText } from './themed-text';

/** How far a blocked swipe is allowed to travel before it stops dead. */
const BLOCKED_CLAMP = 24;

/**
 * One person to answer for.
 *
 * Month and day are grids rather than the scrolling chip rows the add form uses, and that
 * is the whole reason this component exists instead of reusing `BirthdayFields`. A
 * horizontal swipe starting on a horizontally scrolling row is ambiguous — scroll the row,
 * or throw the card? A grid has no horizontal scroll, so the axis belongs entirely to the
 * gesture and there is nothing to arbitrate. Tapping the 25th directly is fewer
 * interactions than scrolling to find it, too.
 *
 * Every gesture also has a button. A swipe cannot be performed by a screen reader, and
 * gesture-only actions would make the deck unusable with TalkBack and VoiceOver.
 */
export function TriageCard({
  displayName,
  draft,
  onChangeDraft,
  onAction,
  canSave,
  error,
  onBlocked,
}: {
  displayName: string;
  draft: PersonDraft;
  onChangeDraft: (next: PersonDraft) => void;
  onAction: (action: TriageAction) => void;
  canSave: boolean;
  /** Shown when a save was attempted with an incomplete date. */
  error: string | null;
  onBlocked: () => void;
}) {
  const theme = useTheme();
  const translateX = useSharedValue(0);
  // Collapsed by default. Most birthdays you know are day and month only, and a year field
  // sitting open invites people to invent one.
  const [showYear, setShowYear] = useState(false);

  /** Button path: no fly-out, the card is replaced immediately. */
  const commit = (action: TriageAction) => {
    translateX.value = 0;
    onAction(action);
  };

  /**
   * Swipe path: start the card leaving and report the action in the same breath.
   *
   * No animation callback, deliberately. The parent swaps in the next card on `onAction`,
   * which unmounts this one, so the fly-out and the commit never need ordering — and a
   * `withTiming` completion callback would be a second worklet boundary to get right for
   * no gain.
   */
  const flyOutAndCommit = (action: 'save' | 'defer') => {
    translateX.value = withTiming(action === 'save' ? 600 : -600, { duration: 160 });
    onAction(action);
  };

  /**
   * Runs on the JS thread, because `resolveSwipe` lives in `src/domain/` and is not a
   * worklet — and must not become one, since that module is kept free of UI-framework
   * concepts on purpose. Only the release crosses the boundary; the drag itself never
   * leaves the UI thread.
   */
  const finishSwipe = (translationX: number) => {
    const outcome = resolveSwipe({ translationX, canSave });

    if (outcome === 'save' || outcome === 'defer') {
      flyOutAndCommit(outcome);
      return;
    }

    translateX.value = withSpring(0);
    if (outcome === 'blocked') onBlocked();
  };

  const pan = Gesture.Pan()
    // Arms only on a decisive horizontal drag, so a vertical scroll never throws the card.
    .activeOffsetX([-15, 15])
    .failOffsetY([-20, 20])
    .onUpdate((event) => {
      // Worklet. Pure shared-value maths — `canSave` is a captured plain boolean, which is
      // copied into the worklet and safe to read.
      const wantsSave = event.translationX > 0;
      translateX.value =
        wantsSave && !canSave ? Math.min(event.translationX, BLOCKED_CLAMP) : event.translationX;
    })
    .onEnd((event) => {
      // Worklet. Decides nothing itself — see `finishSwipe`.
      scheduleOnRN(finishSwipe, event.translationX);
    });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  const days = useMemo(() => {
    // February offers 29 so leap-day birthdays are enterable; the domain decides where a
    // 29 February lands in a common year, not this picker.
    const length = draft.month === null ? 31 : draft.month === 2 ? 29 : monthLength(draft.month);
    return Array.from({ length }, (_, i) => i + 1);
  }, [draft.month]);

  const selectMonth = (month: number) => {
    // A day the new month cannot hold is cleared rather than silently coerced to the 28th.
    const keepsDay = draft.day !== null && isValidMonthDay(month, draft.day);
    onChangeDraft({ ...draft, month, day: keepsDay ? draft.day : null });
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, { backgroundColor: theme.backgroundElement }, cardStyle]}>
        <ThemedText type="subtitle">{displayName}</ThemedText>

        <ThemedText type="smallBold">Month</ThemedText>
        <View style={styles.grid}>
          {MONTH_NAMES.map((name, index) => (
            <Chip
              key={name}
              label={name.slice(0, 3)}
              accessibilityLabel={name}
              selected={draft.month === index + 1}
              onPress={() => selectMonth(index + 1)}
            />
          ))}
        </View>

        <ThemedText type="smallBold">Day</ThemedText>
        <View style={styles.grid}>
          {days.map((day) => (
            <Chip
              key={day}
              label={String(day)}
              selected={draft.day === day}
              onPress={() => onChangeDraft({ ...draft, day })}
            />
          ))}
        </View>

        {showYear ? (
          <TextInput
            value={draft.year}
            onChangeText={(year) =>
              onChangeDraft({ ...draft, year: year.replace(/\D/g, '').slice(0, 4) })
            }
            placeholder="Year"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            accessibilityLabel="Birth year, optional"
            style={[styles.year, { color: theme.text, borderColor: theme.backgroundSelected }]}
          />
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setShowYear(true)}>
            <ThemedText type="small" themeColor="textSecondary">
              + year (optional)
            </ThemedText>
          </Pressable>
        )}

        {error ? (
          <ThemedText type="small" themeColor="textSecondary">
            {error}
          </ThemedText>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Skip ${displayName} for now`}
            onPress={() => commit('defer')}
          >
            <ThemedText type="smallBold" themeColor="textSecondary">
              ← Skip
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Never ask about ${displayName} again`}
            onPress={() => commit('refuse')}
          >
            <ThemedText type="small" themeColor="textSecondary">
              Don't ask again
            </ThemedText>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Save ${displayName}'s birthday`}
            accessibilityState={{ disabled: !canSave }}
            onPress={() => (canSave ? commit('save') : onBlocked())}
          >
            <ThemedText type="smallBold" themeColor={canSave ? 'text' : 'textSecondary'}>
              Save →
            </ThemedText>
          </Pressable>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

function monthLength(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  year: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
    minWidth: 96,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.three,
  },
});
