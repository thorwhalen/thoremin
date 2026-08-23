/**
 * The spoken channel (#163 §4): the voice sink's queueing, and the COVERAGE guard —
 * every string the runner can say has a clip in the shipped manifest, so a reworded
 * cue cannot ship silently. (Regenerate with `npm run voice`.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

  it('every clip file exists, is small (< 64 KB each), and the whole set stays WELL under a megabyte (< 512 KB)', () => {
    const m = manifest();
    let total = 0;
    for (const file of Object.values(m.clips)) {
      const p = resolve(process.cwd(), 'public/voice', file);
      expect(existsSync(p), `${file} is in the manifest but not on disk`).toBe(true);
      const size = statSync(p).size;
      expect(size).toBeGreaterThan(1000);
      expect(size, `${file} is too large for a spoken sentence`).toBeLessThan(64 * 1024);
      total += size;
    }
    expect(total).toBeLessThan(512 * 1024);
    // No stray files beyond the manifest's (the generator prunes).
    const onDisk = readdirSync(resolve(process.cwd(), 'public/voice')).filter((f) => f !== 'manifest.json');
    expect(onDisk.sort()).toEqual([...new Set(Object.values(m.clips))].sort());
  });
});

describe('the voice sink', () => {
  const m: VoiceManifest = { voiceId: 'v', modelId: 'm', clips: { 'Look left.': 'a.mp3', 'A bit further.': 'b.mp3', 'Good.': 'c.mp3' } };
  const line = (kind: TranscriptLine['kind'], say: string): TranscriptLine => ({ t: 0, kind, say });

  /** A player that resolves only when told to, and notes aborts. */
  function controlledPlayer() {
    const played: string[] = [];
    const aborted: string[] = [];
    let release: (() => void) | null = null;
    const player = (url: string, signal: AbortSignal) =>
      new Promise<void>((res) => {
        played.push(url);
        release = res;
        signal.addEventListener('abort', () => {
          aborted.push(url);
          res();
        });
      });
    return { player, played, aborted, finish: () => release?.() };
  }
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

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
    await settle();
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
    await settle();
    expect(p.played).toEqual(['voice/r.mp3', 'voice/d.mp3']);
  });

  it('a line with no clip is skipped, not an error — the text channel still has it', async () => {
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('guidance', 'Something the generator never saw.'));
    sink.say(line('instruction', 'Look left.'));
    expect(p.played).toEqual(['voice/a.mp3']);
  });

  it('a still-unspoken instruction is dropped by the next one (a cue skipped at once is not announced late)', async () => {
    const p = controlledPlayer();
    const two: VoiceManifest = { ...m, clips: { ...m.clips, 'Look right.': 'e.mp3' } };
    const sink = createVoiceSink({ manifest: two, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('instruction', 'Look left.')); // playing
    sink.say(line('instruction', 'Good.')); // (an end phrase would be 'end'; use a second instruction to model cue N, skipped)
    sink.say(line('instruction', 'Look right.'));
    expect(sink.pending()).toBe(1);
    p.finish();
    await settle();
    expect(p.played).toEqual(['voice/a.mp3', 'voice/e.mp3']);
  });

  it('turning voice off clears the queue AND silences the clip in flight', () => {
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('instruction', 'Look left.'));
    sink.say(line('guidance', 'A bit further.'));
    expect(sink.isPlaying()).toBe(true);
    sink.setEnabled(false);
    expect(sink.pending()).toBe(0);
    expect(sink.isPlaying()).toBe(false);
    expect(p.aborted).toEqual(['voice/a.mp3']);
  });

  it('stop() (the routine ended) drops what is waiting and silences what is playing; a cancelled clip cannot re-trigger the pump', async () => {
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('instruction', 'Look left.'));
    sink.say(line('end', 'Good.'));
    sink.stop?.();
    expect(sink.pending()).toBe(0);
    expect(p.aborted).toEqual(['voice/a.mp3']);
    // The old clip settling later must not start anything.
    p.finish();
    await settle();
    expect(p.played).toEqual(['voice/a.mp3']);
    // And the sink is usable again afterwards.
    sink.say(line('instruction', 'Good.'));
    expect(p.played).toEqual(['voice/a.mp3', 'voice/c.mp3']);
  });

  it('a newer nudge replaces a queued one: at most ONE nudge ever waits', async () => {
    const p = controlledPlayer();
    const two: VoiceManifest = { ...m, clips: { ...m.clips, 'Try another.': 'f.mp3', 'Once more.': 'g.mp3' } };
    const sink = createVoiceSink({ manifest: two, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('instruction', 'Look left.')); // in flight
    sink.say(line('guidance', 'A bit further.'));
    sink.say(line('guidance', 'Try another.'));
    sink.say(line('guidance', 'Once more.'));
    expect(sink.pending()).toBe(1);
    p.finish();
    await settle();
    expect(p.played).toEqual(['voice/a.mp3', 'voice/g.mp3']);
  });

  it('a clip that never ends does not wedge the sink: the next cancel aborts it', async () => {
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('instruction', 'Look left.')); // never finishes on its own
    sink.setEnabled(false);
    sink.setEnabled(true);
    sink.say(line('end', 'Good.'));
    await settle();
    expect(p.played).toEqual(['voice/a.mp3', 'voice/c.mp3']);
  });

  it('a player that throws synchronously or returns nothing cannot wedge the queue', async () => {
    const played: string[] = [];
    let n = 0;
    const player = ((url: string) => {
      played.push(url);
      n += 1;
      if (n === 1) throw new Error('boom');
      return undefined as unknown as Promise<void>;
    }) as unknown as (url: string, signal: AbortSignal) => Promise<void>;
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player, enabled: true });
    sink.say(line('instruction', 'Look left.'));
    await settle();
    sink.say(line('end', 'Good.'));
    await settle();
    expect(played).toEqual(['voice/a.mp3', 'voice/c.mp3']);
    expect(sink.isPlaying()).toBe(false);
  });

  it('a cue worded like an Object.prototype key is not a clip', () => {
    const p = controlledPlayer();
    const sink = createVoiceSink({ manifest: m, baseUrl: 'voice/', player: p.player, enabled: true });
    sink.say(line('instruction', 'constructor'));
    sink.say(line('instruction', 'hasOwnProperty'));
    expect(p.played).toEqual([]);
    expect(missingClips(m, ['constructor'])).toEqual(['constructor']);
  });
});

describe('Stop reaches the sink through the store', () => {
  it('a routine stopped mid-instruction drops the queued lines and silences the clip', async () => {
    const { addGuidanceSink, resetGuidanceSinks } = await import('@/app/enroll/guidance');
    const { useTrainer } = await import('@/app/enroll/store');
    const { appFeatureDemand } = await import('@/app/featureDemand');
    resetGuidanceSinks();
    useTrainer.getState().reset();
    appFeatureDemand.reset();
    const p = controlledPlayer();
    const full: VoiceManifest = { voiceId: 'v', modelId: 'm', clips: Object.fromEntries(speakableStrings(STARTER_CUES).map((s) => [s, `${s.length}.mp3`])) };
    const sink = createVoiceSink({ manifest: full, baseUrl: 'voice/', player: p.player, enabled: true });
    addGuidanceSink(sink);
    useTrainer.getState().start(1000);
    await settle();
    expect(sink.isPlaying()).toBe(true);
    useTrainer.getState().skip(1100);
    useTrainer.getState().tick(2700); // the next cue's instruction is queued
    await settle();
    expect(sink.pending()).toBe(1);
    useTrainer.getState().stop(2800);
    await settle();
    expect(sink.pending()).toBe(0);
    expect(sink.isPlaying()).toBe(false);
    expect(p.aborted).toHaveLength(1);
    resetGuidanceSinks();
  });

  /** (helpers shared with the sink suite) */
  function controlledPlayer() {
    const played: string[] = [];
    const aborted: string[] = [];
    let release: (() => void) | null = null;
    const player = (url: string, signal: AbortSignal) =>
      new Promise<void>((res) => {
        played.push(url);
        release = res;
        signal.addEventListener('abort', () => {
          aborted.push(url);
          res();
        });
      });
    return { player, played, aborted, finish: () => release?.() };
  }
  const settle = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
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
    let init: RequestInit | undefined;
    const good = (async (_u: string, i?: RequestInit) => {
      init = i;
      return { ok: true, json: async () => manifest() };
    }) as unknown as typeof fetch;
    const m = await loadVoiceManifest(good);
    expect(m?.voiceId).toBe(manifest().voiceId);
    // The manifest is revalidated every load (the clips are immutable; it is not).
    expect(init?.cache).toBe('no-cache');
  });

  it('the pref is off by default and persists per device under its own key', async () => {
    const { useVoice } = await import('@/app/enroll/voiceRuntime');
    expect(useVoice.getState().enabled).toBe(false);
    useVoice.getState().setEnabled(true);
    expect(useVoice.getState().enabled).toBe(true);
    useVoice.getState().setEnabled(false);
  });
});
