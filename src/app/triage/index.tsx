import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TriageCard } from '@/components/triage-card';
import { Spacing } from '@/constants/theme';
import { createPerson } from '@/db/people';
import { skipContact } from '@/db/skipped';
import { EMPTY_PERSON_DRAFT, type PersonDraft, parsePersonDraft } from '@/domain/draft';
import { cardsFor, type ImportCandidate } from '@/domain/import';
import type { PersonSource } from '@/domain/person';
import { advance, currentCard, makeDeck, progress, type TriageAction } from '@/domain/triage';
import { useSourceScan } from '@/hooks/use-source-scan';
import { useTheme } from '@/hooks/use-theme';
import { calendarSource } from '@/sources/calendar';
import { contactsSource } from '@/sources/contacts';

/**
 * The deck.
 *
 * Re-scans on mount rather than receiving four hundred candidates through router params:
 * that keeps the route deep-linkable and correct after the app has been backgrounded for a
 * week, and passing that much through navigation state is not what it is for.
 *
 * Every action writes immediately. Batching to the end would mean fewer writes and forty
 * ways to lose forty cards of work.
 */

/**
 * A card's own answer, as an editable draft.
 *
 * Contacts cards arrive with no date and this is just their name. Calendar cards arrive with
 * both, and the user is confirming rather than entering — so the date is pre-filled and the
 * name is pre-filled and correctable.
 */
function draftFromCandidate(candidate: ImportCandidate): PersonDraft {
  return {
    ...EMPTY_PERSON_DRAFT,
    displayName: candidate.displayName,
    month: candidate.birthday?.month ?? null,
    day: candidate.birthday?.day ?? null,
    year: candidate.birthday?.year == null ? '' : String(candidate.birthday.year),
  };
}

export default function TriageScreen() {
  const router = useRouter();
  const theme = useTheme();
  // Defaults to contacts, so `/triage` with no param keeps working — including a link saved
  // before this route took a param at all.
  const { source: raw } = useLocalSearchParams<{ source?: string }>();
  const source: PersonSource = raw === 'calendar' ? 'calendar' : 'contacts';
  const birthdaySource = source === 'calendar' ? calendarSource : contactsSource;

  const { scan, rescan } = useSourceScan(birthdaySource);
  const [cursor, setCursor] = useState(0);
  const [draft, setDraft] = useState<PersonDraft>(EMPTY_PERSON_DRAFT);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [writeFailure, setWriteFailure] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const deck = useMemo(() => {
    if (scan.state !== 'ready') return null;
    return makeDeck(cardsFor(source, scan.result.partitioned));
  }, [scan, source]);

  if (scan.state === 'failed') {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Triage' }} />
        <ThemedText type="subtitle">
          {source === 'calendar' ? 'Could not read your calendars' : 'Could not read your contacts'}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centredText}>
          {scan.error.message}
        </ThemedText>
        <ActionButton label="Try again" onPress={rescan} />
      </ThemedView>
    );
  }

  if (scan.state === 'scanning' || !deck) {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Triage' }} />
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (scan.state === 'ready' && scan.result.access === 'none') {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Triage' }} />
        <ThemedText type="subtitle">
          {source === 'calendar' ? 'Calendars are off' : 'Contacts are off'}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centredText}>
          {source === 'calendar'
            ? 'Nenrin cannot read your calendars. Everything else still works — you can add people by hand, and turn calendars on later in your device settings.'
            : 'Nenrin cannot read your address book. Everything else still works — you can add people by hand, and turn contacts on later in your device settings.'}
        </ThemedText>
        <ActionButton label="Go back" onPress={() => router.back()} />
      </ThemedView>
    );
  }

  const state = { cards: deck.cards, cursor };
  const card = currentCard(state);

  // Seeding during render, not in an effect. An effect would paint one frame with the
  // *previous* card's date still in the fields, and on a deck the user is flicking through
  // that frame is visible. React re-runs the body before committing, so nothing reaches the
  // screen half-seeded.
  //
  // This is also the only reset there is: `nextCard` no longer clears the draft, so there is
  // one place a card's draft comes from and no way for one card's edits to leak into the
  // next.
  if (card && seededFor !== card.externalId) {
    setSeededFor(card.externalId);
    setDraft(draftFromCandidate(card));
  }

  const peek = currentCard(advance(state));
  const { done, total } = progress(state);

  if (!card) {
    return (
      <ThemedView style={styles.centred}>
        <Stack.Screen options={{ title: 'Triage' }} />
        <ThemedText type="subtitle">
          {total === 0 ? 'Nothing to go through' : 'That is everyone'}
        </ThemedText>
        <ActionButton label="Done" onPress={() => router.back()} />
      </ThemedView>
    );
  }

  // No `displayName: card.displayName` override any more. The draft is seeded from the card
  // and, for calendar cards, is the thing the user edits — overriding it here would validate
  // the parsed title while saving something else.
  const parsed = parsePersonDraft(draft, new Date().getFullYear());
  const canSave = parsed.ok;

  // Derived, not stored: a stored validation message goes stale the moment the user picks
  // the missing field, and the previous version left it on screen until the next card.
  const validationMessage = !parsed.ok
    ? (parsed.errors.birthday ?? parsed.errors.year ?? parsed.errors.displayName ?? null)
    : null;

  const nextCard = () => {
    setCursor(advance(state).cursor);
    setWriteFailure(null);
    setShowValidation(false);
  };

  const handle = async (action: TriageAction) => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === 'save') {
        if (!parsed.ok) return;
        await createPerson({
          displayName: parsed.value.displayName,
          birthday: parsed.value.birthday,
          // `source`, not 'contacts'. The hardcoded version typechecks, runs, and files
          // every calendar person under contacts — which breaks de-duplication silently:
          // `listExternalIdsBySource('calendar')` would never find them, so the same ten
          // people would be dealt again on every scan.
          source,
          externalId: card.externalId,
        });
      } else {
        await skipContact(source, card.externalId, action === 'refuse' ? 'refused' : 'deferred');
      }
      nextCard();
    } catch (cause) {
      // The cursor deliberately does not advance on a failed write — but on the swipe path
      // the card has already animated off-screen, so without this the user is left looking
      // at nothing at all. Bumping `attempt` remounts the card to bring it back.
      setWriteFailure(
        cause instanceof Error ? `Could not save that — ${cause.message}` : 'Could not save that.',
      );
      setAttempt((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: `${done} of ${total}` }} />
      <View style={styles.deck}>
        {/*
         * A glimpse of who is next, so the deck reads as a stack rather than one card that
         * keeps changing its name. Deliberately not a second `TriageCard`: that would mount
         * a second `GestureDetector` under the live one and put two pan handlers in the
         * same place. This is inert scenery.
         */}
        {peek ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.peek, { backgroundColor: theme.backgroundElement }]}
          >
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {peek.displayName}
            </ThemedText>
          </View>
        ) : null}

        {/*
         * Keyed per person *and* per attempt. The per-person half stops the previous
         * card's translateX leaking into the next one, which would draw it already flung
         * off-screen. The attempt half remounts the same card after a failed write, which
         * is the only way to bring it back from ±600 — TriageCard owns that value and
         * deliberately does not reset it.
         */}
        <TriageCard
          key={`${card.externalId}:${attempt}`}
          displayName={draft.displayName}
          onChangeName={
            source === 'calendar'
              ? (displayName) => setDraft((current) => ({ ...current, displayName }))
              : undefined
          }
          draft={draft}
          onChangeDraft={setDraft}
          onAction={handle}
          canSave={canSave}
          error={writeFailure ?? (showValidation ? validationMessage : null)}
          onBlocked={() => setShowValidation(true)}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  deck: { flex: 1, justifyContent: 'center', padding: Spacing.three },
  peek: {
    position: 'absolute',
    left: Spacing.five,
    right: Spacing.five,
    top: Spacing.three,
    borderRadius: 12,
    padding: Spacing.three,
    opacity: 0.6,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  centredText: {
    textAlign: 'center',
  },
});
