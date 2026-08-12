# Message templates — design

*Step 9 of `docs/00-design.md`, partial: message generation only. Groups and per-group
notification defaults stay open.*

## Why now

`src/domain/message.ts` is complete, tested, and imported by nothing. `expo-clipboard` is
installed and unused. The domain half of this feature already shipped; what is missing is a
screen and one column. It is the cheapest remaining item in v1 and it closes a module that
currently reads as dead code.

The feature itself is not decoration. The design doc's thesis is that reminders are a solved
category and the friction worth removing is the small one — you get the reminder, you do not
know what to write, you put it off, the day ends. Copy, edit a word, send.

## Scope

**In**

- A `tone` column on `person`, set from the message screen.
- `messageOptions()` in the domain, returning stable ids alongside the rendered text.
- A pushed route, `src/app/message/[id].tsx`: tone chips, a list of templates, an editable
  text box, Copy and Share.
- A "Write a message" action on the person screen.
- Tapping a birthday reminder opens that person's detail screen.

**Out**

- Groups, and deriving tone from group membership. Tone is a person-level column for now;
  when groups land they may become the source, and the nullable column is what leaves that
  door open.
- Per-template edit memory, draft persistence, or a confirm dialog before discarding edits.
- Message history — no record of what was sent, or whether anything was.
- Custom user-authored templates.

## Decisions

**Tone is stored on the person, not picked fresh each time.** An ephemeral picker means
re-deciding every year that your mother is family. One nullable column removes that.

**Null tone is distinct from `'close'`.** `DEFAULT_TONE = 'close'` is applied when reading,
not written into the column. So "never set" stays visible, and a future groups-derived tone
can fill in only where the user has not decided.

**The tone chips are the tone editor.** No tone field on the person edit form. Tone is only
meaningful next to the messages it produces, and two UIs writing one nullable column is
surface for no gain.

**Selecting a template overwrites your edits.** Switching tone resets selection and text.
The alternatives — per-template edit memory, a confirm dialog — are real complexity for a
screen used for ten seconds a year per person.

**A pushed route, not a bottom sheet on the person screen.** `person/[id].tsx` already
manages a seeded draft behind a `ready` gate; adding a second independent draft to it is how
that file stops being readable.

**Templates carry ids out of the domain.** With pick-then-edit, selection needs a handle
that survives a tone switch. An array index silently points at a different message the
moment the list changes.

## Changes

### 1. Schema — `src/db/schema.ts`

```ts
/** Relationship tone for suggested messages. Null means the user has never chosen one. */
tone: text('tone').$type<Tone>(),
```

Then `npm run db:generate`. The app applies the generated bundle, not the schema file, so the
schema edit alone does nothing at runtime.

`Tone` is imported type-only from `@/domain/message`, matching how `PersonSource` is already
imported into the schema — the pointer goes schema → domain, never the reverse.

### 2. Domain — `src/domain/message.ts`

Additive. Nothing existing changes shape.

```ts
export const DEFAULT_TONE: Tone = 'close';

export type MessageOption = { id: string; text: string };

export function messageOptions(args: {
  displayName: string;
  age: number | null;
  tone: Tone;
}): MessageOption[];
```

`messagesFor()` stays and becomes `messageOptions(args).map((o) => o.text)`, so its existing
tests pass unchanged and any future caller wanting plain strings still has one.

### 3. Domain — `src/domain/person.ts`

`Person` gains `tone: Tone | null`.

### 4. Mappers — `src/db/mappers.ts`

`toPerson` reads `row.tone`. The `NewPerson` input type gains `tone?: Tone | null`, and
`toNewPersonRow` passes it through — so a future import source can set a tone at creation
without a second write. Unlike the birthday, tone needs no validation on the way out: an
unrecognised string can only produce an empty option list, which the screen already has to
handle.

### 5. Repository — `src/db/people.ts`

```ts
export async function setTone(id: string, tone: Tone): Promise<void>;
```

One column plus `updatedAt`. Separate from `updatePerson` because tone has nothing to do with
the birthday, and a narrow function is easier to reason about at the one boundary v2 hooks
backup into.

**Known interaction, to verify on device.** `updatedAt` is what `Schedulable.knownSince`
reads, and `armWindow`'s catch-up branch fires a reminder whose moment has passed when the
schedule changed *after* that moment. So tapping a tone chip in the afternoon, for someone
whose reminder fired that morning, can re-fire it. If the device confirms this, the fix is
for `setTone` to leave `updatedAt` untouched and for v2 to carry a separate dirty flag —
not to widen `knownSince`.

### 6. Route — `src/app/message/[id].tsx`

Named `message/[id]`, not `person/[id]/message`: the latter collides with the existing
`person/[id].tsx` file route. Registered in `_layout.tsx` alongside the other pushed screens.

Reads the person with `usePerson(id)`. Local state is exactly two values:

- `selectedId: string | null`
- `text: string`

Tone is not local state — it lives in the database and arrives through the live query.
Tapping a chip calls `setTone`, the query re-fires, and a change in the person's tone resets
`selectedId` and `text`.

Layout, top to bottom: three tone chips; the template list as radio-style rows; an editable
multi-line `TextInput` holding the chosen message; Copy and Share.

- Copy → `Clipboard.setStringAsync(text)`, then a short confirmation line. No alert.
- Share → `Share.share({ message: text })` from React Native core.

Age comes from the person's birthday via the existing domain helper; when the birth year is
unknown, `messageOptions` drops the age templates, exactly as `messagesFor` already does.

### 7. Person screen — `src/app/person/[id].tsx`

A "Write a message" row above the remove footer, pushing `/message/${id}`.

### 8. Notification tap — `src/notifications/use-notification-tap.ts`

`personId` is already in every reminder's `data` payload; nothing about scheduling changes.

The Expo docs' pattern for this imports `expo-notifications` at module scope and uses the
`useLastNotificationResponse` hook. **Neither is usable here** — a module-scope import of
that package crashes the whole app in Expo Go on Android (see `AGENTS.md`), and a hook cannot
be reached through the dynamic loader. So:

- An effect awaits `loadNotifications()` and returns early on null.
- `getLastNotificationResponse()` handles the cold start — the app was closed when the
  notification was tapped.
- `addNotificationResponseReceivedListener` handles the warm case, removed on unmount.
- Both route to `/person/${personId}`.

Ignore responses whose `actionIdentifier` is not `DEFAULT_ACTION_IDENTIFIER`, and ignore the
development test reminder, which carries `test: true` and no `personId`.

Called from `AppStack` next to `useReminders`, so it sits below the migration gate.

The destination is the person's detail screen, not the message screen: the reminder can fire
up to a week early, and landing straight on "write a message" would be wrong most of the
time. The message screen is one tap further.

## Error handling

| Case | Behaviour |
|---|---|
| Birth year unknown | Age templates filtered out. Not an error. |
| Every template for a tone needs an age | Empty list with an explanatory line, not a crash. |
| Person deleted while the screen is open | Same `Centred` "Not here" fallback as `person/[id]`. |
| Clipboard write fails | Status line. No alert — nothing the user can act on. |
| Share sheet dismissed | No-op. |
| `expo-notifications` unavailable (Expo Go) | Tap handling silently absent. Every other route works. |

## Verification

**Vitest** — `src/domain/message.test.ts` grows cases for `messageOptions`:

- ids are the template ids, stable across calls
- age-dependent templates dropped when age is null, present when it is not
- only the requested tone is returned
- a tone whose every template needs an age returns an empty array for a null age
- `messagesFor` still returns what it returned before

**`npm run check`, `npm run lint`, `npm test`**, then a bundle check — the migration import
is exactly the class of failure all three miss:

```bash
npx expo export --platform android --output-dir /tmp/nenrin-export
```

**On the device** (development build; a tone tap and a notification tap are both
device-only):

- Set a tone, leave the screen, come back — the same tone is selected.
- Switch tone with text edited — selection and text reset.
- Copy, then paste into another app.
- Share, and cancel the sheet.
- A person with no birth year — no age templates, no crash.
- Tap a reminder with the app closed → lands on that person. Repeat with the app
  backgrounded.
- **The `updatedAt` interaction above:** with a person whose reminder fired this morning,
  tap a tone chip and confirm no duplicate notification arrives.
