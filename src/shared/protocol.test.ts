import { describe, expect, it } from 'vitest';
import { cleanChat, MAX_CHAT } from './protocol.ts';

describe('cleanChat', () => {
  it('keeps ordinary text', () => {
    expect(cleanChat('Хороший ход!')).toBe('Хороший ход!');
  });

  it('flattens line breaks and control characters into single spaces', () => {
    expect(cleanChat('  раз\n\nдва\tтри\u0000 ')).toBe('раз два три');
  });

  it('drops empty and non-text input', () => {
    expect(cleanChat('   \n ')).toBe('');
    expect(cleanChat(42)).toBe('');
    expect(cleanChat(undefined)).toBe('');
  });

  it('cuts overly long messages', () => {
    expect(cleanChat('я'.repeat(MAX_CHAT + 50))).toHaveLength(MAX_CHAT);
  });
});
