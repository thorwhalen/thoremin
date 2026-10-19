/**
 * The orchestra's soundfont and its map (#187 PR 5; D10 on #168): the committed SF3 holds
 * exactly the programs `BANK_PROGRAMS` names, every program a shipped score asks for is
 * one of them (so a shipped piece never plays a stand-in), the file is under the
 * self-hosting threshold and its licence travels beside it; and the part-to-channel map.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import { allocateChannels, BANK_PROGRAMS, bankProgramFor, DEFAULT_PROGRAM, PERCUSSION_CHANNEL, sectionOf } from '@/nodes/output/orchestra_map';
import { DEMO_SCORES } from '@/score/library';
import { SOUNDFONT_SIZE_MB } from '@/nodes/output/orchestra';
import { loadScore } from '@/score/load';

const SF3 = 'public/soundfonts/orchestra.sf3';
/** D10: self-host when the cut is under this. */
const SELF_HOST_LIMIT = 15e6;

describe('the shipped orchestra soundfont', () => {
  it('is under the self-hosting threshold, with its licence beside it', () => {
    expect(statSync(SF3).size).toBeLessThan(SELF_HOST_LIMIT);
    // The size the toggle states before the download is the file's, to a tenth of a MB.
    expect(Math.round(statSync(SF3).size / 1e5) / 10).toBe(SOUNDFONT_SIZE_MB);
    const licence = readFileSync('public/soundfonts/LICENSE.md', 'utf8');
    expect(licence).toMatch(/MIT/);
    expect(licence).toMatch(/must be included in any derivative work/);
  });

  it('holds exactly BANK_PROGRAMS, as SF3 (compressed samples), on bank 0', async () => {
    await BasicSoundBank.isSF3DecoderReady;
    const bytes = readFileSync(SF3);
    const bank = SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(bank.presets.map((p) => p.program).sort((a, b) => a - b)).toEqual([...BANK_PROGRAMS].sort((a, b) => a - b));
    expect(bank.presets.every((p) => p.bankMSB === 0 && !p.isGMGSDrum)).toBe(true);
    expect(bank.samples.every((s) => s.isCompressed)).toBe(true);
  });

  it('covers every program the shipped scores name', async () => {
    for (const demo of DEMO_SCORES) {
      const path = `public/${demo.file}`;
      expect(existsSync(path), path).toBe(true);
      const doc = await loadScore(new Uint8Array(readFileSync(path)), demo.file);
      for (const part of doc.parts) {
        if (part.percussion || part.program === undefined) continue;
        expect(BANK_PROGRAMS, `${demo.id} ${part.name}`).toContain(part.program);
      }
    }
  });
});

describe('the orchestra map', () => {
  it('sorts GM programs into sections', () => {
    expect(sectionOf(40)).toBe('strings');
    expect(sectionOf(48)).toBe('strings');
    expect(sectionOf(47)).toBe('percussion');
    expect(sectionOf(60)).toBe('brass');
    expect(sectionOf(73)).toBe('woodwinds');
    expect(sectionOf(0)).toBe('other');
    expect(sectionOf(0, true)).toBe('percussion');
  });

  it('plays a program the bank lacks with its nearest family member, else the default', () => {
    expect(bankProgramFor(41)).toBe(41);
    expect(bankProgramFor(undefined)).toBe(DEFAULT_PROGRAM);
    // The research map's orchestral set is kept (#334 b): a horn plays a horn.
    for (const p of [44, 45, 46, 56, 57, 58, 59, 60, 61, 72]) expect(bankProgramFor(p), `GM ${p}`).toBe(p);
    // What the bank lacks plays the nearest kept program of its family, else the default.
    expect(bankProgramFor(62)).toBe(61); // synth brass -> brass section
    expect(bankProgramFor(52)).toBe(49); // choir aahs -> slow strings (nearest in its family)
    expect(bankProgramFor(0)).toBe(DEFAULT_PROGRAM); // the piano's samples alone are 15 MB: left out
    expect(bankProgramFor(24)).toBe(DEFAULT_PROGRAM); // a guitar
  });

  it('shares a channel per program, keeps channel 10 for percussion, and never drops a part', () => {
    const parts = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, program: [40, 41, 42, 43, 47, 48, 68, 69, 70, 71, 73][i % 11], percussion: false }));
    parts.push({ id: 'drums', program: 0, percussion: true });
    const alloc = allocateChannels(parts);
    expect(alloc).toHaveLength(parts.length);
    expect(alloc.at(-1)).toMatchObject({ channel: PERCUSSION_CHANNEL, section: 'percussion' });
    expect(alloc.filter((a) => a.channel === PERCUSSION_CHANNEL)).toHaveLength(1);
    expect(new Set(alloc.slice(0, 11).map((a) => a.channel)).size).toBe(11);
    for (let i = 11; i < 20; i++) expect(alloc[i].channel).toBe(alloc[i - 11].channel);
  });

  it('overflowing 15 melodic channels shares a neighbour channel and its program', () => {
    const parts = Array.from({ length: 17 }, (_, i) => ({ id: `p${i}`, program: i, percussion: false }));
    const alloc = allocateChannels(parts, Array.from({ length: 128 }, (_, i) => i));
    const channels = new Set(alloc.map((a) => a.channel));
    expect(channels.size).toBe(15);
    expect(channels.has(PERCUSSION_CHANNEL)).toBe(false);
    const byChannel = new Map<number, number>();
    for (const a of alloc) {
      if (byChannel.has(a.channel)) expect(a.program).toBe(byChannel.get(a.channel));
      byChannel.set(a.channel, a.program);
    }
  });
});
