import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { PersonForm } from '@/components/person-form';
import { createPerson } from '@/db/people';
import { EMPTY_PERSON_DRAFT, type PersonDraft, parsePersonDraft } from '@/domain/draft';

export default function NewPersonScreen() {
  const [draft, setDraft] = useState<PersonDraft>(EMPTY_PERSON_DRAFT);

  const save = async () => {
    const parsed = parsePersonDraft(draft, new Date().getFullYear());
    if (!parsed.ok) return parsed.errors;

    await createPerson({
      displayName: parsed.value.displayName,
      birthday: parsed.value.birthday,
      notes: parsed.value.notes,
      source: 'manual',
    });
    router.back();
    return null;
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Add a person' }} />
      <PersonForm draft={draft} onChange={setDraft} onSubmit={save} submitLabel="Save" />
    </>
  );
}
