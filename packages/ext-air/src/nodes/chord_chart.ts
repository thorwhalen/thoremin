/**
 * `chord-chart` node: conduct a chord chart (H9 of #613, `docs/design/harmonic-layers.md` §6.6).
 * The piece the conductor conducts, reduced to its chords beat by beat (`../lib/chord_chart`),
 * is walked by the conductor's own beat: the chord in force at the beat sounds, voice-led, and
 * its figuration (an arpeggio, a pulse) steps on the conductor's beats, so the accompaniment
 * follows the conductor's tempo, holds through a fermata and waits while he waits, as the
 * orchestra does. Nothing sounds before the first downbeat.
 *
 * Composed from the harmonic layers: the chart is a path through chords, the conductor's
 * musical time is the navigation (`harmony/clock`), the realization pipeline voices and figures
 * it (`harmony/realize`, the instrument's Chord sound settings). Off by default; pure and
 * Node-safe.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { createRealizer, DEFAULT_CONTROLS, DEFAULT_SPEC, tonesInRegister } from '@thoremin/sdk/harmony/realize';
import { beatAt, type BeatSource } from '@thoremin/sdk/harmony/clock';
import { chordName, pitchClasses, type Chord } from '@thoremin/sdk/harmony/chord';
import { SoundSchema } from '@thoremin/sdk/music/sounds';
import { RENDERINGS, VOICINGS, type RenderingId, type VoicingId } from '@thoremin/sdk/music/voicing';
import type { SynthParams, VoiceParams } from '@thoremin/sdk/nodes/domain';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import { chartAt, chartOfScore, type ChordChart } from '../lib/chord_chart';

/** The chart's voices: a block of their own (the chord map's is 4_000_000, the wheel's 5_000_000). */
export const CHORD_CHART_VOICE_ID_BASE = 6_000_000;
export const MAX_CHORD_CHART_VOICES = 5;
/** The register a chord's root is placed in (C3 = 48), before the octave shift. */
const ROOT_BASE = 48;

const Params = z.object({
  enabled: z.boolean().default(false),
  /** Beats read as one chord when the piece is reduced (1: every beat; 2: half bars; 4: bars). */
  step: z.number().int().min(1).max(4).default(1),
  gain: z.number().min(0).max(1).default(0.2),
  sound: SoundSchema.default('warmPad'),
  voicing: z.enum(VOICINGS).default('voiceLed'),
  rendering: z.enum(RENDERINGS).default('arpUpDown'),
  bpm: z.number().min(40).max(200).default(100),
});
type Params = z.infer<typeof Params>;
export const ChordChartDialSchema = Params;
export type ChordChartDialParams = Params;

interface ChordConfig {
  sound?: VoiceParams['sound'];
  gain?: number;
  voicing?: VoicingId;
  rendering?: RenderingId;
  bpm?: number;
}

export interface ChordChartStatus {
  enabled: boolean;
  /** A piece is loaded and spells chords. */
  hasChart: boolean;
  /** How many chord changes the chart has. */
  changes: number;
  /** The conductor's beat runs (false: waiting for the downbeat, or not conducting). */
  running: boolean;
  /** The chord in force and the next one, named. */
  chord: string | null;
  next: string | null;
  /** The beat the conductor is on. */
  beat: number | null;
}

export const IDLE_CHORD_CHART_STATUS: ChordChartStatus = { enabled: false, hasChart: false, changes: 0, running: false, chord: null, next: null, beat: null };

/** A chord's tones on the chart's register, root first. */
function tonesOf(chord: Chord): number[] {
  const base = ROOT_BASE + chord.root;
  return pitchClasses(chord).map((p) => base + ((p - chord.root + 12) % 12));
}

export const chordChartNode = defineNode<Params>({
  type: 'chord-chart',
  roles: ['mapping', 'music'],
  title: 'Chord chart',
  description:
    "Conduct a chord chart: the piece the conductor conducts, reduced to its chords beat by beat, walked by the conductor's beat; the chord in force sounds voice-led, its arpeggio stepping on his beats, holding through a fermata. Off by default.",
  inputs: [
    // The conductor's musical time: what walks the chart.
    { name: 'time', kind: 'musical-time' },
    // The piece being conducted.
    { name: 'doc', kind: 'score-doc' },
    { name: 'config', kind: 'chord-chart-config' },
    { name: 'chordConfig', kind: 'chord-config' },
    { name: 'octaveShift', kind: 'number', default: 0 },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'status', kind: 'chord-chart-status' },
    // The chord in force, un-voiced ([] for none): the shared chord display.
    { name: 'triad', kind: 'number[]' },
  ],
  params: Params,
  make(p) {
    const realizer = createRealizer({ idBase: CHORD_CHART_VOICE_ID_BASE, maxVoices: MAX_CHORD_CHART_VOICES });
    let cfg: Params = p;
    let lastConfigRef: unknown = undefined;
    let chart: ChordChart | null = null;
    let chartDoc: unknown = undefined;
    let chartStep = -1;

    const resolveConfig = (raw: unknown): Params => {
      if (raw === lastConfigRef) return cfg;
      lastConfigRef = raw;
      const parsed = raw && typeof raw === 'object' ? Params.partial().safeParse(raw) : null;
      cfg = parsed?.success ? ({ ...p, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) } as Params) : p;
      return cfg;
    };

    return {
      process(inputs, ctx: NodeContext) {
        const c = resolveConfig(inputs.config);
        const chordCfg = (inputs.chordConfig as ChordConfig | undefined) ?? {};
        const shift = typeof inputs.octaveShift === 'number' && Number.isFinite(inputs.octaveShift) ? Math.round(inputs.octaveShift) : 0;
        const now = typeof ctx?.time === 'number' ? ctx.time : 0;
        const doc = (inputs.doc as ScoreDoc | null | undefined) ?? null;
        // The chart is the piece's, reduced once per piece and step.
        if (doc !== chartDoc || c.step !== chartStep) {
          chart = doc && Array.isArray(doc.parts) ? chartOfScore(doc, { step: c.step }) : null;
          chartDoc = doc;
          chartStep = c.step;
        }
        const time = inputs.time as (BeatSource & { tempo: number }) | undefined;
        // A fermata holds the beat (the harmony waits with the music); before the downbeat, nothing.
        const beat = c.enabled ? beatAt(time, now, { holds: true }) : null;
        const at = chart && beat !== null ? chartAt(chart, beat) : null;
        const chord = at?.segment.chord ?? null;
        const tones = chord ? tonesOf(chord) : [];
        const { voices } = realizer.render({
          tones: tonesInRegister(tones),
          spec: { ...DEFAULT_SPEC, voicing: chordCfg.voicing ?? c.voicing, figuration: chordCfg.rendering ?? c.rendering },
          controls: { ...DEFAULT_CONTROLS, register: shift },
          bpm: time && Number.isFinite(time.tempo) && time.tempo > 0 ? time.tempo : (chordCfg.bpm ?? c.bpm),
          beat: beat ?? undefined,
          gain: chordCfg.gain ?? c.gain,
          sound: chordCfg.sound ?? c.sound,
          silentSound: p.sound,
          dt: typeof ctx?.dt === 'number' ? ctx.dt : 0,
        });
        const status: ChordChartStatus = {
          enabled: c.enabled,
          hasChart: !!chart && chart.segments.length > 0,
          changes: chart?.segments.length ?? 0,
          running: beat !== null,
          chord: chord ? chordName(chord) : null,
          next: at && at.next !== at.segment ? chordName(at.next.chord) : null,
          beat,
        };
        return { params: { voices } satisfies SynthParams, status, triad: tones };
      },
    };
  },
});
