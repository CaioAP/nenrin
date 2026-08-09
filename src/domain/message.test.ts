import { describe, expect, it } from 'vitest';

import { firstNameOf, messagesFor, renderTemplate, TEMPLATES } from './message';

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
