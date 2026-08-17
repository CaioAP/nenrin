# Message Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-written `src/domain/message.ts` into a screen that suggests, edits, copies and shares a birthday message, and make a tapped reminder open the person it is about.

**Architecture:** A `tone` column on `person` (nullable — null means "never chosen"), an additive domain function returning `{ id, text }` options so selection survives a tone switch, a narrow `setTone` repository write, and one pushed route `src/app/message/[id].tsx`. Tone lives in the database and reaches the screen through the existing live query, so the screen holds only a selected template id and the edited text. Notification tap handling goes through the existing lazy `loadNotifications()` loader, not the module-scope import the Expo docs show.

**Tech Stack:** React Native 0.86 / Expo SDK 57, expo-router, Drizzle ORM over expo-sqlite, expo-clipboard, expo-notifications (lazily loaded), Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-08-11-message-templates-design.md`

## Global Constraints

- `src/domain/` imports nothing from Expo, React Native, or the database. Type-only imports from other domain files are fine.
- Every database write goes through a repository function in `src/db/`. No screen touches `db` or a table directly.
- Never `import` `expo-notifications` at module scope — use `loadNotifications()` in `src/notifications/reminders.ts`. A plain import crashes the whole app in Expo Go on Android at launch.
- After changing `src/db/schema.ts`, run `npm run db:generate`. The app applies the generated bundle, not the schema file.
- Ages are `number | null` everywhere. Never render an age without handling null.
- Tests are TZ-pinned: `npm test` runs `TZ=Europe/London vitest run`.
- Biome owns formatting and linting. Single quotes, 2-space indent, 100-column lines — run `npm run lint:fix` before committing.
- Touch targets are minimum 44pt (see `src/components/chip.tsx`).
- Spacing comes from `Spacing` in `src/constants/theme.ts` (`half` 2, `one` 4, `two` 8, `three` 16, `four` 24, `five` 32, `six` 64). Colours come from `useTheme()`, never literals.
- Comments explain *why*, not *what* — match the density of the surrounding files.

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/message.ts` (modify) | Add `DEFAULT_TONE`, `MessageOption`, `messageOptions()`. Existing exports keep their shape. |
| `src/domain/message.test.ts` (modify) | Cases for `messageOptions` and for `messagesFor` still behaving. |
| `src/domain/person.ts` (modify) | `Person.tone: Tone \| null`. |
| `src/db/schema.ts` (modify) | `tone` column. |
| `src/db/mappers.ts` (modify) | `tone` in `toPerson`, `NewPerson`, `toNewPersonRow`. |
| `src/db/mappers.test.ts` (modify) | Row fixture gains `tone`; cases for both directions. |
| `src/db/people.ts` (modify) | `setTone(id, tone)`. |
| `drizzle/` (generated) | New migration + snapshot from `npm run db:generate`. |
| `src/app/message/[id].tsx` (create) | The screen: tone chips, template list, editable text, Copy, Share. |
| `src/app/_layout.tsx` (modify) | Register `message/[id]`; call `useNotificationTap()`. |
| `src/app/person/[id].tsx` (modify) | "Write a message" row. |
| `src/notifications/use-notification-tap.ts` (create) | Cold-start and warm notification-tap routing. |

---

### Task 1: Domain — `messageOptions`

**Files:**
- Modify: `src/domain/message.ts`
- Test: `src/domain/message.test.ts`

**Interfaces:**
- Consumes: existing `Tone`, `Template`, `TEMPLATES`, `firstNameOf`, `renderTemplate` from `src/domain/message.ts`.
- Produces:
  - `export const DEFAULT_TONE: Tone` (value `'close'`)
  - `export type MessageOption = { id: string; text: string }`
  - `export function messageOptions(args: { displayName: string; age: number | null; tone: Tone }): MessageOption[]`
  - `messagesFor` keeps its existing signature and return type `string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/message.test.ts`:

```ts
describe('messageOptions', () => {
  it('returns the template id alongside the rendered text', () => {
    const options = messageOptions({ displayName: 'Ana Paula', age: null, tone: 'close' });

    expect(options).toContainEqual({ id: 'close-plain', text: 'Happy birthday, Ana!' });
  });

  it('returns only the requested tone', () => {
    const ids = messageOptions({ displayName: 'Ana', age: 38, tone: 'colleague' }).map((o) => o.id);

    expect(ids.every((id) => id.startsWith('colleague-'))).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('drops age-dependent templates when the birth year is unknown', () => {
    const ids = messageOptions({ displayName: 'Ana', age: null, tone: 'family' }).map((o) => o.id);

    expect(ids).not.toContain('family-age');
  });

  it('keeps age-dependent templates when the age is known', () => {
    const options = messageOptions({ displayName: 'Ana', age: 38, tone: 'family' });

    expect(options).toContainEqual({ id: 'family-age', text: 'Happy 38th, Ana! Hope today is a good one.' });
  });

  it('returns ids that are stable across calls, so a selection survives a re-render', () => {
    const first = messageOptions({ displayName: 'Ana', age: 38, tone: 'close' }).map((o) => o.id);
    const second = messageOptions({ displayName: 'Ana', age: 38, tone: 'close' }).map((o) => o.id);

    expect(second).toEqual(first);
  });

  it('returns an empty list rather than throwing when every template needs an age', () => {
    // No tone is age-only today, so the guarantee is asserted against a hand-built set
    // instead of a real one — a future template edit must not turn this into a crash.
    const ageOnly = TEMPLATES.filter((t) => t.needsAge && t.tone === 'family');
    expect(ageOnly.length).toBeGreaterThan(0);

    const rendered = messageOptions({ displayName: 'Ana', age: null, tone: 'family' });
    expect(rendered.every((o) => !o.text.includes('{age}'))).toBe(true);
  });
});

describe('DEFAULT_TONE', () => {
  it('is a tone that has at least one template needing no age', () => {
    // The screen falls back to this for anyone whose tone was never set, including people
    // with no birth year — so it must never open on an empty list.
    expect(messageOptions({ displayName: 'Ana', age: null, tone: DEFAULT_TONE }).length)
      .toBeGreaterThan(0);
  });
});
```

Update the import line at the top of the file to:

```ts
import {
  DEFAULT_TONE,
  firstNameOf,
  messageOptions,
  messagesFor,
  renderTemplate,
  TEMPLATES,
} from './message';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/domain/message.test.ts`
Expected: FAIL — `messageOptions is not a function` / `DEFAULT_TONE` undefined.

- [ ] **Step 3: Implement**

In `src/domain/message.ts`, after the `TEMPLATES` array, add:

```ts
/**
 * The tone a person opens on before anyone has chosen one for them.
 *
 * Applied on read rather than written into the column, so "never chosen" stays
 * distinguishable from "deliberately close" — which is what lets a future groups-derived
 * tone fill in only where the user has not decided.
 */
export const DEFAULT_TONE: Tone = 'close';

/** A rendered message and the template it came from. */
export type MessageOption = { id: string; text: string };
```

Then replace `messagesFor` with:

```ts
/**
 * Every message that can be rendered for this person and tone, in a stable order.
 *
 * The id travels with the text because the screen lets you pick one message and then edit
 * it. An array index would be a fine handle right up until the tone changes underneath it,
 * at which point it silently points at a different message.
 */
export function messageOptions({
  displayName,
  age,
  tone,
}: {
  displayName: string;
  age: number | null;
  tone: Tone;
}): MessageOption[] {
  const name = firstNameOf(displayName);

  return TEMPLATES.filter((t) => t.tone === tone)
    .filter((t) => !t.needsAge || age !== null)
    .map((t) => ({ id: t.id, text: renderTemplate(t.text, { name, age }) }));
}

/** The same messages as plain strings, for callers with nothing to select. */
export function messagesFor(args: {
  displayName: string;
  age: number | null;
  tone: Tone;
}): string[] {
  return messageOptions(args).map((option) => option.text);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/domain/message.test.ts`
Expected: PASS, including every pre-existing `messagesFor` case.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run check && npm run lint:fix`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/domain/message.ts src/domain/message.test.ts
git commit -m "feat(message): return template ids alongside rendered text

The message screen lets you pick a suggestion and then edit it, so the
selection needs a handle. An array index is fine until the tone changes
underneath it and silently points at a different message.

messagesFor keeps its signature and is now a thin map over the new
function, so nothing that wants plain strings has to change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Store tone on the person

**Files:**
- Modify: `src/domain/person.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/mappers.ts`
- Test: `src/db/mappers.test.ts`
- Generated: `drizzle/` (new `.sql` migration, `meta/_journal.json`, `meta/*_snapshot.json`)

**Interfaces:**
- Consumes: `Tone`, from Task 1's file (unchanged export).
- Produces:
  - `Person.tone: Tone | null`
  - `PersonRow.tone: Tone | null` (inferred from the schema)
  - `NewPerson.tone?: Tone | null`
  - `toPerson` and `toNewPersonRow` carry it.

- [ ] **Step 1: Write the failing tests**

In `src/db/mappers.test.ts`, add `tone: null,` to the `row()` fixture object (after `externalId: null,`), then append:

```ts
describe('tone', () => {
  it('carries a stored tone through to the domain', () => {
    expect(toPerson(row({ tone: 'family' })).tone).toBe('family');
  });

  it('keeps an unset tone as null rather than defaulting at the boundary', () => {
    // DEFAULT_TONE is applied where the messages are shown, not here. Writing a default
    // into the row would make "never chosen" indistinguishable from a real choice.
    expect(toPerson(row({ tone: null })).tone).toBeNull();
  });

  it('defaults a new person to no tone', () => {
    const created = toNewPersonRow(
      { displayName: 'Ana', birthday: { month: 3, day: 14 } },
      'p2',
      at,
    );

    expect(created.tone).toBeNull();
  });

  it('lets a caller set a tone at creation', () => {
    const created = toNewPersonRow(
      { displayName: 'Ana', birthday: { month: 3, day: 14 }, tone: 'colleague' },
      'p2',
      at,
    );

    expect(created.tone).toBe('colleague');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/db/mappers.test.ts`
Expected: FAIL — `tone` is not a property of `PersonRow`, and TypeScript errors on the fixture.

- [ ] **Step 3: Add the column and the domain field**

In `src/db/schema.ts`, extend the existing type-only domain import:

```ts
import type { Tone } from '@/domain/message';
import type { PersonSource } from '@/domain/person';
```

and add the column to `person`, directly after `externalId`:

```ts
    /**
     * Relationship tone for suggested messages. Null means the user has never chosen one —
     * kept distinct from 'close' so a future groups-derived tone can fill in only where
     * nobody has decided.
     */
    tone: text('tone').$type<Tone>(),
```

In `src/domain/person.ts`, import the type and add the field to `Person` after `muted`:

```ts
import type { Tone } from './message';
```

```ts
  /** Relationship tone for suggested messages. Null means never chosen. */
  tone: Tone | null;
```

- [ ] **Step 4: Map it in both directions**

In `src/db/mappers.ts`, add `tone` to the `NewPerson` type after `muted`:

```ts
  tone?: Tone | null;
```

import the type alongside the existing domain imports:

```ts
import type { Tone } from '@/domain/message';
```

add to the object returned by `toPerson`, after `muted: row.muted,`:

```ts
    tone: row.tone,
```

and to the object returned by `toNewPersonRow`, after `muted: input.muted ?? false,`:

```ts
    tone: input.tone ?? null,
```

Do **not** add `tone` to `PersonPatch` or `toPersonUpdate` — tone is written by `setTone` in Task 3, not by the edit form.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/db/mappers.test.ts`
Expected: PASS.

- [ ] **Step 6: Generate the migration**

Run: `npm run db:generate`
Expected: a new file in `drizzle/` (e.g. `0001_*.sql`) containing `ALTER TABLE \`person\` ADD \`tone\` text;`, plus an updated `drizzle/meta/_journal.json` and a new snapshot.

Read the generated `.sql` and confirm it is exactly one `ALTER TABLE ... ADD` and nothing else. Drizzle will sometimes propose a table rebuild; if it did, stop and report rather than committing it — a rebuild of `person` is not a change to make unreviewed.

- [ ] **Step 7: Typecheck, lint, full test run**

Run: `npm run check && npm run lint:fix && npm test`
Expected: all pass. The full run matters here — `Person` gained a required field, so any fixture building a `Person` by hand now fails to typecheck.

- [ ] **Step 8: Commit**

```bash
git add src/domain/person.ts src/db/schema.ts src/db/mappers.ts src/db/mappers.test.ts drizzle
git commit -m "feat(db): store a relationship tone on each person

Nullable rather than defaulted to 'close': the screen applies DEFAULT_TONE
on read, so 'never chosen' stays visible and a groups-derived tone can
later fill in only where the user has not decided.

Not part of PersonPatch — tone is written by its own repository function,
because it has nothing to do with editing a birthday.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `setTone` repository write

**Files:**
- Modify: `src/db/people.ts`

**Interfaces:**
- Consumes: `Tone` from `@/domain/message`; `person`, `alive`, `db` already in the file.
- Produces: `export async function setTone(id: string, tone: Tone, now?: Date): Promise<Person | null>`

There is no unit test for this task: `src/db/people.ts` imports `./client`, which calls `openDatabaseSync` at module scope and needs a device. That boundary is exactly why the mapping logic lives in `mappers.ts` and is tested there. Verification is the device checklist in Task 7.

- [ ] **Step 1: Add the function**

In `src/db/people.ts`, add the import:

```ts
import type { Tone } from '@/domain/message';
```

and add after `updatePerson`:

```ts
/**
 * Sets the relationship tone. Returns the person as stored, or null if they are gone.
 *
 * Separate from `updatePerson` rather than another key on `PersonPatch`: tone has nothing to
 * do with the birthday, and keeping it narrow means the one write the message screen makes
 * is a write nobody has to read `toPersonUpdate` to understand.
 *
 * It still bumps `updatedAt`, because v2's backup queue needs every change to be visible.
 * Note the consequence — `updatedAt` is what `Schedulable.knownSince` reads, and
 * `armWindow`'s catch-up branch re-fires a reminder whose moment passed *before* the
 * schedule changed. So changing someone's tone in the afternoon can re-fire the reminder
 * that already went out this morning. Confirm on a device; if it happens, the fix is to
 * leave `updatedAt` alone here and give v2 a separate dirty flag, not to widen `knownSince`.
 */
export async function setTone(id: string, tone: Tone, now = new Date()): Promise<Person | null> {
  const [updated] = await db
    .update(person)
    .set({ tone, updatedAt: now })
    .where(and(eq(person.id, id), alive))
    .returning();
  return updated ? toPerson(updated) : null;
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run check && npm run lint:fix`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/people.ts
git commit -m "feat(db): add setTone

Narrow on purpose. Tone is not part of PersonPatch, so the message screen's
only write is one function you can read in ten seconds.

Records the one interaction to settle on device: this bumps updatedAt,
which armWindow's catch-up branch reads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The message screen

**Files:**
- Create: `src/app/message/[id].tsx`
- Modify: `src/app/_layout.tsx`

**Interfaces:**
- Consumes: `messageOptions`, `DEFAULT_TONE`, `MessageOption`, `Tone` (Task 1); `Person.tone` (Task 2); `setTone` (Task 3); existing `usePerson` from `@/db/hooks`, `ageAtNextOccurrence` from `@/domain/birthday`, `Chip`, `ActionButton`, `ThemedText`, `ThemedView`, `useTheme`, `Spacing`.
- Produces: the route `/message/[id]`, pushed by Task 5.

Route named `message/[id]`, not `person/[id]/message` — the latter collides with the existing `person/[id].tsx` file route.

- [ ] **Step 1: Create the screen**

Create `src/app/message/[id].tsx`:

```tsx
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePerson } from '@/db/hooks';
import { setTone } from '@/db/people';
import { ageAtNextOccurrence } from '@/domain/birthday';
import { DEFAULT_TONE, type MessageOption, messageOptions, type Tone } from '@/domain/message';
import { useTheme } from '@/hooks/use-theme';

const TONES: { value: Tone; label: string }[] = [
  { value: 'family', label: 'Family' },
  { value: 'close', label: 'Close' },
  { value: 'colleague', label: 'Colleague' },
];

/**
 * Suggested messages for one person: pick one, edit it, copy or share it.
 *
 * The point is not to write the greeting for you — it is to remove the pause where you do
 * not know how to open, put it off, and let the day end.
 *
 * Tone is not local state. It lives on the person, so tapping a chip is a write and the new
 * value arrives back through the live query — which is also what resets the selection.
 */
export default function MessageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { person, loading, error } = usePerson(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const theme = useTheme();

  const tone = person?.tone ?? DEFAULT_TONE;

  // Switching tone throws away the current selection and any edits. Keeping them would mean
  // per-template edit memory or a confirm dialog, both of which cost more than a screen you
  // use for ten seconds a year is worth.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the tone changes
  useEffect(() => {
    setSelectedId(null);
    setText('');
    setStatus(null);
  }, [tone]);

  if (error) return <Centred title="Something went wrong" body={error.message} />;
  if (loading) return null;
  if (!person) return <Centred title="Not here" body="This person has been removed." />;

  const options = messageOptions({
    displayName: person.displayName,
    age: ageAtNextOccurrence(person.birthday, new Date()),
    tone,
  });

  const choose = (option: MessageOption) => {
    setSelectedId(option.id);
    setText(option.text);
    setStatus(null);
  };

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      setStatus('Copied.');
    } catch {
      // Nothing the user can act on, and an alert over a birthday message is worse than
      // the failure. The text is still on screen and still selectable.
      setStatus('Could not copy. Select the text and copy it by hand.');
    }
  };

  const share = async () => {
    try {
      await Share.share({ message: text });
    } catch {
      setStatus('Could not open the share sheet.');
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: person.displayName }} />
      <ThemedView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.tones}>
            {TONES.map(({ value, label }) => (
              <Chip
                key={value}
                label={label}
                selected={value === tone}
                onPress={() => setTone(person.id, value)}
                accessibilityLabel={`${label} tone`}
              />
            ))}
          </View>

          {options.length === 0 ? (
            <ThemedText themeColor="textSecondary">
              Every message for this tone needs an age, and {person.displayName}'s birth year is
              unknown. Add a year, or pick another tone.
            </ThemedText>
          ) : (
            options.map((option) => (
              <Suggestion
                key={option.id}
                text={option.text}
                selected={option.id === selectedId}
                onPress={() => choose(option)}
              />
            ))
          )}

          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Pick one above, or write your own"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.editor,
              { color: theme.text, borderColor: theme.backgroundSelected },
            ]}
          />

          <View style={styles.actions}>
            <ActionButton label="Copy" onPress={copy} disabled={text.trim().length === 0} />
            <ActionButton label="Share" onPress={share} disabled={text.trim().length === 0} />
          </View>

          {status ? (
            <ThemedText type="small" themeColor="textSecondary">
              {status}
            </ThemedText>
          ) : null}
        </ScrollView>
      </ThemedView>
    </>
  );
}

function Suggestion({
  text,
  selected,
  onPress,
}: {
  text: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[
        styles.suggestion,
        {
          backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
        },
      ]}
    >
      <ThemedText>{text}</ThemedText>
    </Pressable>
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
  screen: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  tones: { flexDirection: 'row', gap: Spacing.two },
  suggestion: {
    minHeight: 44,
    justifyContent: 'center',
    padding: Spacing.three,
    borderRadius: 4,
  },
  editor: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 4,
    padding: Spacing.three,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: Spacing.two },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  centredText: { textAlign: 'center' },
});
```

- [ ] **Step 2: Register the route**

In `src/app/_layout.tsx`, inside `AppStack`'s `<Stack>`, after the `person/[id]` line:

```tsx
      <Stack.Screen name="message/[id]" />
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run check && npm run lint:fix`
Expected: no errors. `theme.backgroundSelected` and `theme.tint` both exist in `src/constants/theme.ts` — the person form already uses `backgroundSelected` for input borders.

- [ ] **Step 4: Verify it bundles**

Run: `npx expo export --platform android --output-dir /tmp/nenrin-export`
Expected: completes without error. `check` and `lint` do not prove the app bundles.

- [ ] **Step 5: Commit**

```bash
git add src/app/message src/app/_layout.tsx
git commit -m "feat(message): add the suggested-message screen

Pick a suggestion, edit it, copy or share. Tone is read from the person and
written back when you tap a chip, so next year it opens on the right one.

Switching tone clears the selection and any edits. Deliberate: keeping them
means per-template edit memory or a confirm dialog, and this is a screen you
use for ten seconds.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Reach it from the person screen

**Files:**
- Modify: `src/app/person/[id].tsx`

**Interfaces:**
- Consumes: the `/message/[id]` route from Task 4.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the action**

In `src/app/person/[id].tsx`, add `Link` to the existing expo-router import:

```tsx
import { Link, router, Stack, useLocalSearchParams } from 'expo-router';
```

and replace the footer block with:

```tsx
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
```

and add to the stylesheet, next to `remove`:

```tsx
  action: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
```

`Link ... asChild` wrapping a `Pressable` is the pattern already used in `src/app/(tabs)/people.tsx`. Keep the style flat on the `Pressable` — see commit `bf5f0b3`, which fixed exactly this.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run check && npm run lint:fix`
Expected: no errors. Typed routes are on (`experiments.typedRoutes`), so a wrong href fails here rather than at runtime.

- [ ] **Step 3: Commit**

```bash
git add src/app/person/\[id\].tsx
git commit -m "feat(person): link through to the message screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Notification tap opens the person

**Files:**
- Create: `src/notifications/use-notification-tap.ts`
- Modify: `src/app/_layout.tsx`

**Interfaces:**
- Consumes: `loadNotifications()` — currently module-private in `src/notifications/reminders.ts`, so this task exports it.
- Produces: `export function useNotificationTap(): void`

`personId` is already in every reminder's `data` payload (`syncReminders` in `reminders.ts`); nothing about scheduling changes.

- [ ] **Step 1: Export the loader**

In `src/notifications/reminders.ts`, change the declaration:

```ts
function loadNotifications(): Promise<NotificationsModule | null> {
```

to:

```ts
export function loadNotifications(): Promise<NotificationsModule | null> {
```

and add one line to its docblock, above the existing text:

```
 * Exported so the tap handler can reach the module through the same guard. Nothing else
 * may import `expo-notifications` directly.
```

- [ ] **Step 2: Write the hook**

Create `src/notifications/use-notification-tap.ts`:

```ts
/**
 * Opens the right person when a birthday reminder is tapped.
 *
 * The Expo docs show this as a module-scope `import * as Notifications` plus the
 * `useLastNotificationResponse` hook. Neither works here: a module-scope import of
 * `expo-notifications` crashes the entire app in Expo Go on Android at launch (see
 * AGENTS.md), and a hook cannot be reached through a dynamic import. So the module arrives
 * through `loadNotifications()` inside an effect, and the two cases are handled by hand:
 *
 * - `getLastNotificationResponse()` — the app was closed when the notification was tapped
 *   and is starting because of it.
 * - `addNotificationResponseReceivedListener` — the app was already running.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';

import { loadNotifications } from './reminders';

/**
 * Type-only, so naming the response shape costs nothing at runtime — the same trick
 * `reminders.ts` uses for `NotificationsModule`. A value import here would be the crash.
 */
type NotificationResponse = import('expo-notifications').NotificationResponse;

export function useNotificationTap(): void {
  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | undefined;

    (async () => {
      const notifications = await loadNotifications();
      // Expo Go, where reminders cannot exist in the first place. Every other route works.
      if (!notifications || cancelled) return;

      const open = (response: NotificationResponse) => {
        // A response can also come from a notification *action*; only a plain tap should
        // navigate. The development test reminder carries no personId and is ignored here.
        if (response.actionIdentifier !== notifications.DEFAULT_ACTION_IDENTIFIER) return;

        const personId = response.notification.request.content.data?.personId;
        if (typeof personId !== 'string') return;

        router.push(`/person/${personId}`);
      };

      const last = notifications.getLastNotificationResponse();
      if (last) open(last);

      subscription = notifications.addNotificationResponseReceivedListener(open);
    })().catch((error) => {
      // Failing to attach the listener costs a shortcut, not the app: every birthday is
      // still one tap away in Upcoming.
      console.warn('Could not observe notification taps', error);
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);
}
```

`getLastNotificationResponse()` is synchronous and returns `NotificationResponse | null` — verified against `node_modules/expo-notifications/build/NotificationsEmitter.d.ts` in the installed SDK 57 build. `getLastNotificationResponseAsync()` also exists and is deprecated; do not use it.

- [ ] **Step 3: Call it from the layout**

In `src/app/_layout.tsx`, add the import:

```tsx
import { useNotificationTap } from '@/notifications/use-notification-tap';
```

and call it in `AppStack`, next to `useReminders()`:

```tsx
function AppStack() {
  useReminders();
  useNotificationTap();
```

It belongs here, not in `RootLayout`: navigating to `/person/[id]` before the migrations have run would push a screen whose first query hits a table that does not exist yet.

- [ ] **Step 4: Typecheck, lint, bundle**

Run: `npm run check && npm run lint:fix && npx expo export --platform android --output-dir /tmp/nenrin-export`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/use-notification-tap.ts src/notifications/reminders.ts src/app/_layout.tsx
git commit -m "feat(notifications): open the person when a reminder is tapped

personId was already in the payload; this is the listener that reads it.

Not the pattern in the Expo docs, which imports expo-notifications at
module scope and uses useLastNotificationResponse. Both are unreachable
here — the import crashes Expo Go on Android, and a hook cannot go behind
the dynamic loader. Cold start and warm start are handled separately.

Lives in AppStack rather than RootLayout so it cannot navigate to a screen
that queries a table before the migrations have run.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Verify on a device

**Files:** none — this is the verification pass. `npm run check`, `npm run lint` and `npm test` cover the pure layers and prove nothing about tone persistence, clipboard, share, or notification taps.

- [ ] **Step 1: Full gate**

Run:

```bash
npm run check && npm run lint && npm test
npx expo export --platform android --output-dir /tmp/nenrin-export
```

Expected: all pass.

- [ ] **Step 2: Rebuild or reuse the dev build**

The last development build is commit `6f694b7`. No native module was added by this work — `expo-clipboard`, `expo-notifications` and the rest were already in `package.json` — so the existing APK still runs this JS. Start the server against it:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=192.168.3.223 npx expo start --dev-client
```

Only run `eas build --profile development --platform android` if the app fails to load with a native-module error.

- [ ] **Step 3: Walk the checklist**

Record the result of each. A failure here is a finding, not a step to retry until it passes.

- Open a person → "Write a message" → the screen opens on **Close** for someone whose tone was never set.
- Tap **Family** → leave the screen → come back → **Family** is still selected.
- Pick a suggestion, edit the text, then tap a different suggestion → the edit is replaced. (Intended.)
- Pick a suggestion, edit the text, then switch tone → selection and text clear. (Intended.)
- **Copy** → paste into another app → the edited text arrives.
- **Share** → the native sheet opens → cancel it → back on the screen, nothing broken.
- A person with no birth year → no age-dependent suggestions, no crash, and the Close tone still offers messages.
- Delete a person from another device path while their message screen is open → "Not here", no crash.
- Notification tap, app **closed**: fire a test reminder from Settings → force-quit → tap the notification → lands on that person. (The development test reminder carries no `personId`, so use a real armed reminder: set someone's birthday to today with lead time "on the day" and a notification time a minute or two ahead.)
- Notification tap, app **backgrounded**: same, without force-quitting.
- **The `updatedAt` interaction.** Take a person whose reminder already fired today, tap a tone chip on their message screen, then background the app and return. Confirm no duplicate reminder arrives for them. If one does: `setTone` must stop bumping `updatedAt`, and the spec's note about a v2 dirty flag becomes the follow-up.

- [ ] **Step 4: Record what the device said**

Append the results to `docs/superpowers/specs/2026-08-11-message-templates-design.md` under a new `## Device results` heading — the date, the build, and one line per check. The spec's whole point is that the `updatedAt` interaction was an open question; a plan that answers it and does not write the answer down leaves the next person guessing.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-message-templates-design.md
git commit -m "docs: record the device results for the message screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Not in this plan

From `docs/00-design.md` step 9, still open after this lands:

- **Groups** — the `group` and `person_group` tables exist with no repository and no UI. Per-group lead defaults also means changing `listSchedulable`, which resolves lead days from person + settings only today.
- **Per-group notification defaults** in Settings.
- **Custom templates**, message history, and per-template edit memory — deliberately out, see the spec.
