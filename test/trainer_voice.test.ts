/**
 * The spoken channel (#163 §4): the voice sink's queueing, and the COVERAGE guard —
 * every string the runner can say has a clip in the shipped manifest, so a reworded
 * cue cannot ship silently. (Regenerate with `npm run voice`.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { STARTER_CUES } from '@/app/enroll/starterCues';
import { missingClips, speakableStrings, type VoiceManifest } from '@/app/enroll/speakable';
import { createVoiceSink } from '@/app/enroll/voice';
import type { TranscriptLine } from '@/app/enroll/store';

const MANIFEST = resolve(process.cwd(), 'public/voice/manifest.json');
const manifest = (): VoiceManifest => JSON.parse(readFileSync(MANIFEST, 'utf8')) as VoiceManifest;

describe('the speakable set is finite and enumerable from data', () => {
  it('covers every instruction, variation, nudge, reason and phrase, once each', () => {
    const all = speakableStrings(STARTER_CUES);
    expect(new Set(all).size).toBe(all.length);
    for (const c of STARTER_CUES) {
      expect(all).toContain(c.instruction);
      for (const v of c.variations) expect(all).toContain(v);
    }
    expect(all).toContain('Good.');
    expect(all).toContain('Moving on.');
    expect(all).toContain('Hold it still for a moment.');
    expect(all.length).toBeLessThan(60);
  });
});

describe('the shipped clip set', () => {
  it('has ONE voice, and a clip for every speakable string (the coverage guard)', () => {
    const m = manifest();
    expect(m.voiceId).toMatch(/^[A-Za-z0-9]{20}$/);
    const missing = missingClips(m, speakableStrings(STARTER_CUES));
    expect(missing, `regenerate the clips (npm run voice); missing: ${missing.join(' | ')}`).toEqual([]);
  });

  it('every clip file exists, is small, and the whole set stays well under a megabyte', () => {
    const m = manifest();
    let total = 0;
    for (const file of Object.values(m.clips)) {
      const p = resolve(process.cwd(), 'public/voice', file);
      expect(existsSync(p), `${file} is in the manifest but not on disk`).toBe(true);
      const size = statSync(p).size;
      expect(size).toBeGreaterThan(1000);
      total += size;
    }
    expect(total).toBeLessThan(900 * 1024);
  });
});

describe('the voice sink', () => {
  const m: VoiceManifest = { voiceId: 'v', modelId: 'm', clips: { 'Look left.': 'a.mp3', 'A bit further.': 'b.mp3', 'Good.': 'c.mp3' } };
  const line = (kind: TranscriptLine['kind'], say: string): TranscriptLine => ({ t: 0, kind, say });

  /** A player that resolves only when told to. */
  function controlledPlayer() {
    const played: string[] = [];
    let release: (() => void) | null = null;
    const player = (url: string) =>
      new Promise<void>((res) => {
        played.push(url);
        release = res;
      });
    return { player, played, finish: () => release?.() };
  }

  it('is off by default, and says nothing while off', () => {
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player: p.player });
    sink.say(line('instruction', 'Look left.'));
    expect(p.played).toEqual([]);
    expect(sink.isEnabled()).toBe(false);
  });

  it('plays one clip at a time, in order, with the manifest URL', async () => {
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('instruction', 'Look left.'));
    sink.say(line('guidance', 'A bit further.'));
    expect(p.played).toEqual(['voice/a.mp3']);
    expect(sink.pending()).toBe(1);
    p.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(p.played).toEqual(['voice/a.mp3', 'voice/b.mp3']);
  });

  it('a new instruction or an end phrase drops the nudges still waiting (they are stale)', async () => {
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('instruction', 'Look left.'));
    sink.say(line('guidance', 'A bit further.'));
    sink.say(line('end', 'Good.'));
    expect(sink.pending()).toBe(1); // the nudge was dropped; "Good." waits
    p.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(p.played).toEqual(['voice/a.mp3', 'voice/c.mp3']);
  });

  it('a `cannot` speaks the REASON and then "Moving on." — what is written is what is said', async () => {
    const withReason: VoiceManifest = { ...m, clips: { ...m.clips, 'I did not see you move for that one.': 'r.mp3', 'Moving on.': 'd.mp3' } };
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: withReason, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say({ t: 0, kind: 'end', say: 'Moving on.', outcome: 'cannot', why: 'I did not see you move for that one.' });
    expect(p.played).toEqual(['voice/r.mp3']);
    p.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(p.played).toEqual(['voice/r.mp3', 'voice/d.mp3']);
  });

  it('a line with no clip is skipped, not an error — the text channel still has it', async () => {
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('guidance', 'Something the generator never saw.'));
    sink.say(line('instruction', 'Look left.'));
    expect(p.played).toEqual(['voice/a.mp3']);
  });

  it('turning voice off clears the queue', () => {
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('instruction', 'Look left.'));
    sink.say(line('guidance', 'A bit further.'));
    sink.setEnabled(false);
    expect(sink.pending()).toBe(0);
  });
});

describe('the voice runtime', () => {
  it('a missing or malformed manifest yields null (no clips, no error), a good one parses', async () => {
    const { loadVoiceManifest } = await import('@/app/enroll/voiceRuntime');
    const nope = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await loadVoiceManifest(nope)).toBeNull();
    const broken = (async () => ({ ok: true, json: async () => ({ nope: 1 }) })) as unknown as typeof fetch;
    expect(await loadVoiceManifest(broken)).toBeNull();
    const throws = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await loadVoiceManifest(throws)).toBeNull();
    const good = (async () => ({ ok: true, json: async () => manifest() })) as unknown as typeof fetch;
    const m = await loadVoiceManifest(good);
    expect(m?.voiceId).toBe(manifest().voiceId);
  });

  it('the pref is off by default and persists per device under its own key', async () => {
    const { useVoice } = await import('@/app/enroll/voiceRuntime');
    expect(useVoice.getState().enabled).toBe(false);
    useVoice.getState().setEnabled(true);
    expect(useVoice.getState().enabled).toBe(true);
    useVoice.getState().setEnabled(false);
  });
});
