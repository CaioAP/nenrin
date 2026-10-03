import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';

import { GroupPicker } from '@/components/group-picker';
import { PersonForm } from '@/components/person-form';
import { type ReminderChoice, ReminderPicker } from '@/components/reminder-picker';
import { setPersonGroups } from '@/db/groups';
import { useGroups, useSettings } from '@/db/hooks';
import { createPerson } from '@/db/people';
import { EMPTY_PERSON_DRAFT, type PersonDraft, parsePersonDraft } from '@/domain/draft';
import { inheritedLead } from '@/domain/person';

export default function NewPersonScreen() {
  const [draft, setDraft] = useState<PersonDraft>(EMPTY_PERSON_DRAFT);
  const { groups } = useGroups();
  const [groupIds, setGroupIds] = useState<ReadonlySet<string>>(new Set());
  const [reminder, setReminder] = useState<ReminderChoice>({ leadDays: null, muted: false });
  const { settings } = useSettings();
  const inherited = useMemo(
    () =>
      inheritedLead(
        groups.filter((group) => groupIds.has(group.id)),
        settings.defaultLeadDays,
      ),
    [groups, groupIds, settings.defaultLeadDays],
  );

  const save = async () => {
    const parsed = parsePersonDraft(draft, new Date().getFullYear());
    if (!parsed.ok) return parsed.errors;

    const created = await createPerson({
      displayName: parsed.value.displayName,
      birthday: parsed.value.birthday,
      notes: parsed.value.notes,
      leadDays: reminder.leadDays,
      muted: reminder.muted,
      source: 'manual',
    });
    if (groupIds.size > 0) await setPersonGroups(created.id, [...groupIds]);
    router.back();
    return null;
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Add a person' }} />
      <PersonForm
        draft={draft}
        onChange={setDraft}
        onSubmit={save}
        submitLabel="Save"
        autoFocusName
        groups={<GroupPicker groups={groups} selected={groupIds} onChange={setGroupIds} />}
        reminder={<ReminderPicker value={reminder} inherited={inherited} onChange={setReminder} />}
      />
    </>
  );
}
