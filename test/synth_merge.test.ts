/**
 * Tests the `synth-merge` node — the single convergence point that unions the
 * hand voices + both face-chord instruments into one stream, and carries the
 * master mute (#91). Pure + headless via replayNode: no camera, audio, or DOM.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { replayNode, Engine, createRegistry, defineNode } from '@/dag';
import { synthMergeNode, keyboardControlNode } from '@/nodes';
import type { SynthParams, VoiceParams } from '@/nodes/domain';

const voice = (id: number, patch: Partial<VoiceParams> = {}): VoiceParams => ({
  id,
  present: true,
  freq: 440,
  gain: 0.5,
  sound: 'sine',
  brightness: 1,
  vibrato: 0,
  pan: 0,
  ...patch,
});

const params = (voices: VoiceParams[]): SynthParams => ({ voices });

describe('synth-merge', () => {
  it('unions the three streams in order, preserving voice ids + gains', async () => {
    const hands = params([voice(0), voice(1)]); // voice-mapping
    const emo = params([voice(2), voice(3)]); // expression-chord
    const pose = params([voice(6, { gain: 0.3 })]); // pose-chord
    const [out] = await replayNode(synthMergeNode.make({}), {
      a: [hands],
      b: [emo],
      c: [pose],
    });
    const merged = (out.params as SynthParams).voices;
    expect(merged.map((v) => v.id)).toEqual([0, 1, 2, 3, 6]);
    expect(merged.every((v) => v.present)).toBe(true);
    expect(merged.find((v) => v.id === 6)!.gain).toBeCloseTo(0.3);
  });

  it('an absent stream contributes nothing (back-compatible a-only graphs)', async () => {
    const hands = params([voice(0)]);
    const [out] = await replayNode(synthMergeNode.make({}), { a: [hands] });
    // b, c, mute all absent → just the hand voice, unchanged.
    expect((out.params as SynthParams).voices.map((v) => v.id)).toEqual([0]);
  });

  it('master mute silences EVERY voice — hands AND both chord instruments (#91)', async () => {
    // The regression guard for #91: the chord voices (b/c) used to bypass the
    // hand-voice mute entirely and kept sounding. At the merge they all go quiet.
    const hands = params([voice(0), voice(1)]);
    const emo = params([voice(2, { gain: 0.4 }), voice(3, { gain: 0.4 })]);
    const pose = params([voice(6, { gain: 0.4 })]);
    const [out] = await replayNode(synthMergeNode.make({}), {
      a: [hands],
      b: [emo],
      c: [pose],
      mute: [true],
    });
    const merged = (out.params as SynthParams).voices;
    expect(merged).toHaveLength(5);
    // Every voice — including the chord voices (ids 2,3,6) — is now silent.
    expect(merged.every((v) => v.gain === 0)).toBe(true);
    expect(merged.every((v) => !v.present)).toBe(true);
    // Ids are preserved, so the synth still tracks + ramps each voice down by id.
    expect(merged.map((v) => v.id)).toEqual([0, 1, 2, 3, 6]);
  });

  it('mute=false passes every stream through unchanged', async () => {
    const hands = params([voice(0, { gain: 0.5 })]);
    const emo = params([voice(2, { gain: 0.4 })]);
    const [out] = await replayNode(synthMergeNode.make({}), {
      a: [hands],
      b: [emo],
      mute: [false],
    });
    const merged = (out.params as SynthParams).voices;
    expect(merged.every((v) => v.present)).toBe(true);
    expect(merged.find((v) => v.id === 0)!.gain).toBeCloseTo(0.5);
    expect(merged.find((v) => v.id === 2)!.gain).toBeCloseTo(0.4);
  });
});

// A test-only source that scripts the `pressed` keys per tick, so the REAL
// keyboard-control node can be driven through the engine without a browser window.
const pressedSource = defineNode<{ frames: string[][] }>({
  type: 'pressed-source',
  inputs: [],
  outputs: [{ name: 'pressed', kind: 'string[]' }],
  params: z.object({ frames: z.array(z.array(z.string())).default([]) }),
  make({ frames }) {
    let i = 0;
    return {
      process() {
        const pressed = frames[i] ?? [];
        i += 1;
        return { pressed };
      },
    };
  },
});

// A test-only source of always-present synth voices, standing in for a chord
// instrument (expression-chord / pose-chord) that merges in on b / c — the very
// voices that used to bypass the mute (#91).
const chordSource = defineNode<{ base: number }>({
  type: 'chord-source',
  inputs: [],
  outputs: [{ name: 'params', kind: 'synth-params' }],
  params: z.object({ base: z.number().default(2) }),
  make({ base }) {
    return {
      process() {
        return { params: { voices: [voice(base, { gain: 0.4 }), voice(base + 1, { gain: 0.4 })] } };
      },
    };
  },
});

describe('mute composes through the engine end-to-end (m key → chords silent, #91)', () => {
  it('the real keyboard-control → synth-merge wiring silences the chord voices when muted', () => {
    // Closes the gap between the isolated-node test (mute:[true] silences voices)
    // and the edge-existence test (kctrl.mute → merge.mute is wired): here the REAL
    // keyboard-control + synth-merge nodes run through the engine over the exact
    // production edge, with two always-sounding chord streams on b/c. An `m`
    // keypress must silence them — proving the pieces actually compose, so a future
    // port rename or mis-wire can't leave both half-guards green while mute is dead.
    const engine = new Engine(
      {
        nodes: [
          // Press `m` on tick 1 (mute on) and again on tick 3 (mute off).
          { id: 'keys', type: 'pressed-source', params: { frames: [[], ['m'], [], ['m']] } },
          { id: 'kctrl', type: 'keyboard-control', params: {} },
          { id: 'emo', type: 'chord-source', params: { base: 2 } }, // emotion chord → merge.b
          { id: 'pose', type: 'chord-source', params: { base: 6 } }, // pose chord → merge.c
          { id: 'merge', type: 'synth-merge', params: {} },
        ],
        edges: [
          { from: { node: 'keys', port: 'pressed' }, to: { node: 'kctrl', port: 'pressed' } },
          { from: { node: 'kctrl', port: 'mute' }, to: { node: 'merge', port: 'mute' } },
          { from: { node: 'emo', port: 'params' }, to: { node: 'merge', port: 'b' } },
          { from: { node: 'pose', port: 'params' }, to: { node: 'merge', port: 'c' } },
        ],
      },
      createRegistry([pressedSource, chordSource, keyboardControlNode, synthMergeNode]),
    );

    const frames: SynthParams[] = [];
    for (let i = 0; i < 4; i++) {
      engine.tick();
      frames.push(engine.getOutput('merge', 'params') as SynthParams);
    }

    // tick 0: unmuted → both chord streams sound (ids 2,3 emotion + 6,7 pose).
    expect(frames[0].voices.map((v) => v.id)).toEqual([2, 3, 6, 7]);
    expect(frames[0].voices.every((v) => v.present && v.gain > 0)).toBe(true);
    // tick 1: `m` pressed → mute on → EVERY chord voice is silenced (the #91 fix).
    expect(frames[1].voices.every((v) => !v.present && v.gain === 0)).toBe(true);
    // tick 2: no key → mute latches → chords stay silent.
    expect(frames[2].voices.every((v) => !v.present && v.gain === 0)).toBe(true);
    // tick 3: `m` pressed again → unmute → the chords sound again.
    expect(frames[3].voices.every((v) => v.present && v.gain > 0)).toBe(true);
  });
});
