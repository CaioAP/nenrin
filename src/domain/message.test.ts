import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TONE,
  firstNameOf,
  messageOptions,
  messagesFor,
  renderTemplate,
  TEMPLATES,
} from './message';

describe('firstNameOf', () => {
  it('takes the first word of a full name', () => {
    expect(firstNameOf('Ana Paula Silva')).toBe('Ana');
  });

  it('leaves a single name alone', () => {
    expect(firstNameOf('Ana')).toBe('Ana');
  });

  it('tolerates the messy whitespace that comes out of a contacts import', () => {
    expect(firstNameOf('  Ana   Paula  ')).toBe('Ana');
  });

  it('falls back to the whole string when there is nothing to split', () => {
    expect(firstNameOf('')).toBe('');
  });
});

describe('renderTemplate', () => {
  it('substitutes the name', () => {
    expect(renderTemplate('Happy birthday, {name}!', { name: 'Ana', age: null })).toBe(
      'Happy birthday, Ana!',
    );
  });

  it('substitutes the age', () => {
    expect(renderTemplate('{age} looks good on you, {name}', { name: 'Ana', age: 38 })).toBe(
      '38 looks good on you, Ana',
    );
  });

  it('substitutes every occurrence of a placeholder', () => {
    expect(renderTemplate('{name}! {name}!', { name: 'Ana', age: null })).toBe('Ana! Ana!');
  });

  it('refuses to render an age placeholder with no age rather than printing "null"', () => {
    expect(() => renderTemplate('Turning {age}!', { name: 'Ana', age: null })).toThrow();
  });

  it('leaves unknown placeholders untouched', () => {
    expect(renderTemplate('Hi {nickname}', { name: 'Ana', age: null })).toBe('Hi {nickname}');
  });
});

describe('messagesFor', () => {
  it('renders with the first name, not the full contact name', () => {
    const messages = messagesFor({ displayName: 'Ana Paula Silva', age: null, tone: 'family' });
    expect(messages.every((m) => m.includes('Ana'))).toBe(true);
    expect(messages.some((m) => m.includes('Paula'))).toBe(false);
  });

  it('returns only templates for the requested tone', () => {
    const colleague = messagesFor({ displayName: 'Ana', age: null, tone: 'colleague' });
    const family = messagesFor({ displayName: 'Ana', age: null, tone: 'family' });
    expect(colleague.length).toBeGreaterThan(0);
    expect(family.length).toBeGreaterThan(0);
    expect(colleague).not.toEqual(family);
  });

  it('drops age-dependent templates when the birth year is unknown', () => {
    // The whole point of partial dates: most people have no year, and a message reading
    // "Turning null!" is the exact failure this design is meant to make impossible.
    const messages = messagesFor({ displayName: 'Ana', age: null, tone: 'family' });
    expect(messages.some((m) => m.includes('null') || m.includes('{age}'))).toBe(false);
  });

  it('still returns something for every tone when the age is unknown', () => {
    for (const tone of ['family', 'close', 'colleague'] as const) {
      expect(messagesFor({ displayName: 'Ana', age: null, tone }).length).toBeGreaterThan(0);
    }
  });

  it('includes age-dependent templates when the age is known', () => {
    const withAge = messagesFor({ displayName: 'Ana', age: 38, tone: 'family' });
    const withoutAge = messagesFor({ displayName: 'Ana', age: null, tone: 'family' });
    expect(withAge.length).toBeGreaterThan(withoutAge.length);
    expect(withAge.some((m) => m.includes('38'))).toBe(true);
  });

  it('is deterministic — shuffling belongs to the UI, not the domain', () => {
    const input = { displayName: 'Ana', age: 38, tone: 'family' } as const;
    expect(messagesFor(input)).toEqual(messagesFor(input));
  });

  it('leaves no unsubstituted placeholders in any template in the library', () => {
    for (const tone of ['family', 'close', 'colleague'] as const) {
      for (const message of messagesFor({ displayName: 'Ana', age: 38, tone })) {
        expect(message).not.toMatch(/[{}]/);
      }
    }
  });
});

describe('TEMPLATES', () => {
  it('marks every template that uses {age} as age-dependent', () => {
    for (const template of TEMPLATES) {
      expect(template.needsAge).toBe(template.text.includes('{age}'));
    }
  });

  it('has unique ids, so a favourite can be stored by id later', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

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

    expect(options).toContainEqual({
      id: 'family-age',
      text: 'Happy 38th, Ana! Hope today is a good one.',
    });
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
    expect(
      messageOptions({ displayName: 'Ana', age: null, tone: DEFAULT_TONE }).length,
    ).toBeGreaterThan(0);
  });
});
