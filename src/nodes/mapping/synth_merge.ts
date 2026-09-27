/**
 * `synth-merge` node — unions the {@link SynthParams} voice streams of every sound
 * producer into the one stream the synth, MIDI out and the overlay consume.
 *
 * The engine forbids fan-IN to a single input port, so several producers of synth
 * params (the hand `voice-mapping`, the emotion `expression-chord`, the head-pose
 * `pose-chord`, the conducted `score`, the air flute, ...) cannot each wire into the
 * synth's one `params` input. This node is the merge point: it takes them on distinct
 * ports and concatenates their voices. Voices keep their own ids (hands 0/1, emotion
 * chord 2..5, pose chord ≥ 6, ...), so the synth voices them independently and the
 * port a stream arrives on never matters to it.
 *
 * The inputs are two POOLS, named by role rather than by producer (the ADR in
 * `docs/design/instruments-as-graphs-and-extensions.md`, §3.2 rule 3): the composer
 * (`composeGraph`) allocates each branch's declared voice to the next free input of its
 * role, so no graph, test or panel has to remember that "d is the score".
 *
 *  - `voice1..voice8`: INSTRUMENT voices. Silenced by `hush`.
 *  - `score1..score2`: SCORE voices (the conducted piece). Kept under `hush`.
 *
 * Because it is the single convergence point downstream of EVERY sound producer, it
 * carries the master `mute`: when true every merged voice is silenced (gain 0, present
 * false), so muting covers every producer that merges here — fixing #91, where the
 * chords bypassed the hand-voice mute. A second, narrower switch, `hush`, silences the
 * instrument pool and keeps the score pool: a tool that needs quiet to be heard (the
 * Conductor, the Trainer's metronome) raises it instead of `mute`, and a piece being
 * conducted keeps sounding. See `hushOf` in `store-controls`. The synth ramps a gain-0
 * voice down over its per-voice release, so both switches are click-free.
 *
 * Pure + deterministic. An absent/empty input contributes no voices; an absent `mute`
 * or `hush` is treated as false (passthrough).
 */
import { defineNode } from '@/dag';
import type { SynthParams } from '../domain';

const EMPTY: SynthParams = { voices: [] };

const asParams = (v: unknown): SynthParams =>
  v && typeof v === 'object' && Array.isArray((v as SynthParams).voices)
    ? (v as SynthParams)
    : EMPTY;

/** The merge's input pools by voice role, in allocation order. The composer reads this. */
export const SYNTH_MERGE_POOLS = {
  instrument: ['voice1', 'voice2', 'voice3', 'voice4', 'voice5', 'voice6', 'voice7', 'voice8'],
  score: ['score1', 'score2'],
} as const;

const silence = (p: SynthParams): SynthParams['voices'] =>
  p.voices.map((v) => ({ ...v, gain: 0, present: false }));

export const synthMergeNode = defineNode({
  type: 'synth-merge',
  roles: ['mapping'],
  title: 'Synth Merge',
  description:
    'Union the synth-params voice streams into one: eight instrument inputs (hushable) and two score inputs (kept under hush); master mute.',
  inputs: [
    ...SYNTH_MERGE_POOLS.instrument.map((name) => ({ name, kind: 'synth-params' })),
    ...SYNTH_MERGE_POOLS.score.map((name) => ({ name, kind: 'synth-params' })),
    // Master mute: true → silence every merged voice at this single convergence
    // point (all producers pass through here). Absent → false (passthrough).
    { name: 'mute', kind: 'boolean', default: false },
    // Instrument hush: true → silence the instrument pool, keep the score pool.
    { name: 'hush', kind: 'boolean', default: false },
  ],
  outputs: [{ name: 'params', kind: 'synth-params' }],
  process(inputs) {
    const hushed = inputs.hush === true;
    const voices: SynthParams['voices'] = [];
    for (const name of SYNTH_MERGE_POOLS.instrument) {
      const p = asParams(inputs[name]);
      voices.push(...(hushed ? silence(p) : p.voices));
    }
    for (const name of SYNTH_MERGE_POOLS.score) voices.push(...asParams(inputs[name]).voices);
    // Master mute: zero every voice (and mark it absent) so every producer goes quiet
    // together. The synth's per-voice release ramp makes this a smooth fade.
    if (inputs.mute === true) {
      return { params: { voices: voices.map((v) => ({ ...v, gain: 0, present: false })) } };
    }
    return { params: { voices } };
  },
});
