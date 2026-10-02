import { describe, expect, it } from 'vitest';

import { parseBirthdayTitle } from './calendar-title';

describe('parseBirthdayTitle', () => {
  it('reads the name out of an English possessive', () => {
    expect(parseBirthdayTitle("Mãe's birthday")).toEqual({ displayName: 'Mãe', confident: true });
  });

  it('accepts the curly apostrophe Google actually writes', () => {
    expect(parseBirthdayTitle('Mãe’s birthday')).toEqual({ displayName: 'Mãe', confident: true });
  });

  it('keeps everything in the name, emoji included', () => {
    // Real title off the test device. Truncating here would silently rename someone.
    expect(parseBirthdayTitle("Jaque 💜∞'s birthday")).toEqual({
      displayName: 'Jaque 💜∞',
      confident: true,
    });
  });

  it('handles a name already ending in s', () => {
    expect(parseBirthdayTitle("Lucas' birthday")).toEqual({
      displayName: 'Lucas',
      confident: true,
    });
  });

  it('reads Portuguese', () => {
    expect(parseBirthdayTitle('Aniversário de Ana')).toEqual({
      displayName: 'Ana',
      confident: true,
    });
    expect(parseBirthdayTitle('Niver de Ana')).toEqual({ displayName: 'Ana', confident: true });
  });

  it('reads Spanish, German, French and Italian', () => {
    expect(parseBirthdayTitle('Cumpleaños de Ana')?.displayName).toBe('Ana');
    expect(parseBirthdayTitle('Geburtstag von Ana')?.displayName).toBe('Ana');
    expect(parseBirthdayTitle('Anniversaire de Ana')?.displayName).toBe('Ana');
    expect(parseBirthdayTitle('Compleanno di Ana')?.displayName).toBe('Ana');
    expect(parseBirthdayTitle('Ana Geburtstag')?.displayName).toBe('Ana');
  });

  it('is case-insensitive', () => {
    expect(parseBirthdayTitle("ana's BIRTHDAY")).toEqual({ displayName: 'ana', confident: true });
  });

  it('keeps the whole title, unconfident, when no pattern matches', () => {
    // The deck shows this one in an editable field rather than dropping it. Silent loss is
    // the failure shape that produced three wrong measurements on this branch already.
    expect(parseBirthdayTitle('Happy birthday!')).toEqual({
      displayName: 'Happy birthday!',
      confident: false,
    });
  });

  it('does not mistake Universal for niver', () => {
    // The probe's one false positive, from a loose substring token list. `niver` needs a
    // word boundary or every New Year holiday in Brazil becomes a person.
    expect(parseBirthdayTitle('Feriado- Confraternização Universal (Ano Novo)')).toBeNull();
  });

  it('returns null for a title with no birthday word at all', () => {
    expect(parseBirthdayTitle('Dentist')).toBeNull();
    expect(parseBirthdayTitle('   ')).toBeNull();
    expect(parseBirthdayTitle('')).toBeNull();
  });
});
