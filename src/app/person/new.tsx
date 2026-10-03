import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { GroupPicker } from '@/components/group-picker';
import { PersonForm } from '@/components/person-form';
import { setPersonGroups } from '@/db/groups';
import { useGroups } from '@/db/hooks';
import { createPerson } from '@/db/people';
import { EMPTY_PERSON_DRAFT, type PersonDraft, parsePersonDraft } from '@/domain/draft';

export default function NewPersonScreen() {
  const [draft, setDraft] = useState<PersonDraft>(EMPTY_PERSON_DRAFT);
  const { groups } = useGroups();
  const [groupIds, setGroupIds] = useState<ReadonlySet<string>>(new Set());

  const save = async () => {
    const parsed = parsePersonDraft(draft, new Date().getFullYear());
    if (!parsed.ok) return parsed.errors;

    const created = await createPerson({
      displayName: parsed.value.displayName,
      birthday: parsed.value.birthday,
      notes: parsed.value.notes,
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
      />
    </>
  );
}
