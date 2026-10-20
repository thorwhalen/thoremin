/**
 * The shell's quiet badge names why the instrument is quiet (#600 S16c): an open tool that hushes
 * says its own words (`Tool.hushes`; the Trainer's is core's until its slice), an extension hush
 * says its reason, and a claim no tool explains (a carve tool's quiet) says nothing.
 */
import { describe, it, expect } from 'vitest';
import { hushReason } from '@/app/hushReason';
import { SHELL_TOOLS } from '@/app/shellTools';

const tools = [
  { id: 'trainer', hushes: 'while the Trainer is open' },
  { id: 'faces' },
];
const conducting = { id: 'c', reason: 'while conducting', while: (s: Readonly<Record<string, unknown>>) => s.conducting === true };

describe('hushReason', () => {
  it('names the open tool that holds a claim and says why', () => {
    expect(hushReason({ hushedBy: ['trainer'] }, { tools, hushes: [conducting] })).toBe('while the Trainer is open');
  });
  it('says nothing for a claim no tool explains, and nothing with no claim', () => {
    expect(hushReason({ hushedBy: ['faces'] }, { tools, hushes: [] })).toBeNull();
    expect(hushReason({ hushedBy: [] }, { tools, hushes: [] })).toBeNull();
  });
  it('falls through to an extension hush that holds', () => {
    expect(hushReason({ hushedBy: [], conducting: true }, { tools, hushes: [conducting] })).toBe('while conducting');
    expect(hushReason({ hushedBy: ['trainer'], conducting: true }, { tools, hushes: [conducting] })).toBe('while the Trainer is open');
  });
  it('the shipped Trainer tool says its words (the badge text is unchanged)', () => {
    expect(SHELL_TOOLS.find((t) => t.id === 'trainer')?.hushes).toBe('while the Trainer is open');
  });
});
