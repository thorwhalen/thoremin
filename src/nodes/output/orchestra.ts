/**
 * `orchestra` node — the conducted score played by a sampled orchestra (#187 PR 5).
 *
 * Until now the conductor's piece was sung by the theremin synth's oscillators (the
 * `score` node's voices). This node plays it instead through `spessasynth_lib`, a
 * SoundFont synthesizer in an AudioWorklet, with a General MIDI bank cut from
 * MuseScore_General to the programs the shipped scores use (`orchestra_map.ts`,
 * `public/soundfonts/`). Three things make it the conductor's orchestra rather than a
 * MIDI file player:
 *
 *  - **Time comes from the conductor.** The pure pending-event scheduler
 *    (`packages/ictus/src/scheduler.ts`) turns the conductor's `MusicalTime` into
 *    note commands a short horizon ahead (the output stage plus `lookaheadTicks` engine
 *    ticks), each mapped onto the `AudioContext` clock through the one clock map
 *    (`engineToContextTime`), so a note sounds when the follower predicts its beat, and
 *    a committed note is never moved.
 *  - **Dynamics act on notes already sounding.** The conductor's stroke size
 *    (`velocityScale`) is CC11 (expression) on every channel, plus CC74 (brightness,
 *    spessasynth's filter-cutoff modulator), because a softer orchestra is darker as
 *    well as quieter (research map §5.3); the per-section volume dials are CC7.
 *  - **Articulation shortens what is about to start.** A sharp, braking stroke
 *    (`articulation` above the middle) scales the next notes' lengths down by up to
 *    `staccatoDepth`; a smooth one plays them as written.
 *
 * **Nothing loads until the player switches it on** (`conductor.orchestra.enabled`, off
 * by default): the synth comes from an {@link OrchestraEngineFactory}, injected by a host
 * as `ctx.resources.createOrchestraEngine` (tests, headless runs), or the default here,
 * which dynamically imports `./orchestra_engine` (and with it `spessasynth_lib`, its
 * worklet and the 3.7 MB soundfont) the first time. The `status` port speaks the shared
 * `LoadStatus` (`docs/design/lazy-loading.md`), with download progress.
 *
 * **Handing the piece over.** `playing` is true while the orchestra is loaded and the
 * conductor is on; it drives the `score` node's `replaced` input, so the oscillator
 * voices give the piece up exactly when the orchestra can take it, and keep it while the
 * soundfont downloads (the music never stops for a load). A trainer's claim (`claimed`)
 * silences the orchestra like every other voice; the player's mute acts on the master
 * gain the orchestra is mixed into.
 */
import { z } from 'zod';
import { defineNode, realtimeOutputAllowed } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { lazyResource, withActive, type LoadResult, type LoadStatus } from '@thoremin/lazy';
import { createScheduler, type MusicalTime, type ScheduleCommand, type Scheduler, type ScoreEvent } from '@thoremin/ictus';
import { scheduleAt } from '@thoremin/sdk/timing/clock_map';
import { timingFrom } from '@thoremin/sdk/timing/tracker';
import { flattenNotes, ScoreDocSchema, type ScoreDoc } from '@thoremin/sdk/score/schema';
import { DEMO_SCALE_NOTES } from '../music/score';
import { allocateChannels, DEFAULT_PROGRAM, SECTIONS, type Section } from './orchestra_map';

/** The shipped soundfont's size in MB, stated on the toggle before the download (the
 *  lazy-loading rule); `test/orchestra_bank.test.ts` pins it to the committed file. */
export const SOUNDFONT_SIZE_MB = 3.7;

/** MIDI controllers the node sends. */
export const CC = { volume: 7, expression: 11, brightness: 74 } as const;

/**
 * The player's orchestra settings: a structured leaf of the `conductor` dial
 * (`conductor.orchestra.*`), so every field is a `dial.setIn` path for the panel, the
 * palette and the assistant. The node reads it from its `config` input.
 */
export const OrchestraSettingsSchema = z.object({
  /** Off by default: switching it on downloads the soundfont ({@link SOUNDFONT_SIZE_MB} MB, once). */
  enabled: z.boolean().default(false),
  /** The orchestra's overall level, 0..1 (CC7 with the section's own level). */
  volume: z.number().min(0).max(1).default(0.8),
  /** Per-section level, 0..1. */
  sections: z
    .object(Object.fromEntries(SECTIONS.map((s) => [s, z.number().min(0).max(1).default(1)])) as Record<Section, z.ZodDefault<z.ZodNumber>>)
    .default(() => Object.fromEntries(SECTIONS.map((s) => [s, 1])) as Record<Section, number>),
});
export type OrchestraSettings = z.infer<typeof OrchestraSettingsSchema>;
export const DEFAULT_ORCHESTRA: OrchestraSettings = OrchestraSettingsSchema.parse({});

/** The facade the node drives: `spessasynth_lib` in the browser, a recorder in tests.
 *  Times are `AudioContext` seconds. */
export interface OrchestraSynth {
  noteOn(channel: number, key: number, velocity: number, time: number): void;
  noteOff(channel: number, key: number, time: number): void;
  controllerChange(channel: number, cc: number, value: number, time: number): void;
  programChange(channel: number, program: number): void;
  /** Release everything now (the piece changed, the conductor stopped). */
  allNotesOff(): void;
  /** Disconnect and free the synth. */
  close(): void;
}

export interface OrchestraEngineOpts {
  audioContext?: AudioContext;
  /** Where the orchestra mixes its audio (the app's masterGain). */
  destination?: AudioNode;
  signal: AbortSignal;
  progress: (fraction: number) => void;
}

/** Obtains the synth on demand: `ctx.resources.createOrchestraEngine`, else the lazy
 *  browser default. */
export type OrchestraEngineFactory = (opts: OrchestraEngineOpts) => Promise<LoadResult<OrchestraSynth>>;

const _defaultFactory: OrchestraEngineFactory = async (opts) => {
  if (!opts.audioContext || !opts.destination) {
    return { resource: null, reason: 'no-audio', retry: true, message: 'Tap to play first: the orchestra needs the audio graph.' };
  }
  const { createOrchestraEngine } = await import('./orchestra_engine');
  return createOrchestraEngine(opts);
};

/**
 * Where a note's velocity comes from. `raw`: the source's own velocity, as the orchestra
 * has played it since #336. `written`: scaled by the score's dynamics marks through
 * `flattenNotes`, exactly as the `score` node's oscillators voice it, so switching the
 * orchestra on keeps the balance of a `p` passage (#393 item 3). `raw` stays the default
 * until a player has heard the difference: it changes how every marked piece sounds.
 */
export const ORCHESTRA_DYNAMICS = ['raw', 'written'] as const;
export type OrchestraDynamics = (typeof ORCHESTRA_DYNAMICS)[number];
export const DEFAULT_ORCHESTRA_DYNAMICS: OrchestraDynamics = 'raw';

export interface PlanPieceOptions {
  /** {@link OrchestraDynamics}; {@link DEFAULT_ORCHESTRA_DYNAMICS} when absent. */
  dynamics?: OrchestraDynamics;
}

const Params = z.object({
  /** Engine ticks of look-ahead beyond the output stage: the scheduler commits what is
   *  due before the tick after next could send it. */
  lookaheadTicks: z.number().min(1).max(8).default(2),
  /** The most a sharp (staccato) stroke shortens the next notes, as a fraction of their
   *  written length. 0 = articulation ignored. */
  staccatoDepth: z.number().min(0).max(0.9).default(0.5),
  /** How much darker the softest dynamics are (CC74 below its neutral 64). 0 = gain only. */
  brightnessDepth: z.number().min(0).max(1).default(0.5),
  /** The shortest interval between two expression / brightness updates, seconds. */
  ccInterval: z.number().min(0).max(1).default(0.05),
  /** Note velocities as recorded (`raw`) or shaped by the score's dynamics marks
   *  (`written`, as the score node plays them); see {@link OrchestraDynamics}. */
  dynamics: z.enum(ORCHESTRA_DYNAMICS).default(DEFAULT_ORCHESTRA_DYNAMICS),
});
type Params = z.infer<typeof Params>;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const to7bit = (v: number) => Math.round(clamp01(v) * 127);

/** The note-length factor for an articulation (0 legato .. 1 staccato). */
export function durationScaleFor(articulation: number, staccatoDepth: number): number {
  const sharp = clamp01((articulation - 0.5) / 0.5);
  return 1 - staccatoDepth * sharp;
}

/** CC11 / CC74 for the conductor's dynamics (`velocityScale`, 0..1). */
export function dynamicsControllers(velocityScale: number, brightnessDepth: number): { expression: number; brightness: number } {
  const v = clamp01(velocityScale);
  return { expression: to7bit(v), brightness: Math.round(64 - 64 * clamp01(brightnessDepth) * (1 - v)) };
}

/** A piece laid onto channels: the scheduler's events plus each channel's program and section. */
export interface OrchestraPlan {
  events: ScoreEvent[];
  loopBeats: number;
  channels: { channel: number; program: number; section: Section }[];
}

/** Plan a document (or, with none, the built-in demo scale, looped like the `score`
 *  node loops it). */
export function planPiece(doc: ScoreDoc | null, { dynamics = DEFAULT_ORCHESTRA_DYNAMICS }: PlanPieceOptions = {}): OrchestraPlan {
  if (!doc) {
    return {
      events: DEMO_SCALE_NOTES.map((n) => ({ key: n.midi, channel: 0, start: n.start, duration: n.duration, velocity: n.velocity })),
      loopBeats: 8,
      channels: [{ channel: 0, program: DEFAULT_PROGRAM, section: 'strings' }],
    };
  }
  const alloc = allocateChannels(doc.parts);
  const events: ScoreEvent[] = [];
  const channels = new Map<number, { channel: number; program: number; section: Section }>();
  doc.parts.forEach((part, i) => {
    const a = alloc[i];
    // The cut bank holds no drum kit: a GM drum channel would fall back to the bank's
    // first preset and play the drum keys as violin notes. A percussion part is left out
    // (#334 tracks a kit); timpani is a pitched program and plays.
    if (part.percussion) return;
    if (!channels.has(a.channel)) channels.set(a.channel, { channel: a.channel, program: a.program, section: a.section });
    const notes = dynamics === 'written' ? flattenNotes(doc, [part.id]) : part.notes;
    for (const n of notes) events.push({ key: n.midi, channel: a.channel, start: n.start, duration: n.duration, velocity: n.velocity });
  });
  return { events, loopBeats: 0, channels: [...channels.values()].sort((a, b) => a.channel - b.channel) };
}

/** Read the orchestra settings out of the conductor dial (the `config` input). */
function settingsOf(raw: unknown): OrchestraSettings {
  const o = raw && typeof raw === 'object' ? (raw as { orchestra?: unknown }).orchestra : undefined;
  const parsed = OrchestraSettingsSchema.safeParse(o ?? {});
  return parsed.success ? parsed.data : DEFAULT_ORCHESTRA;
}

export const orchestraNode = defineNode<Params>({
  type: 'orchestra',
  roles: ['synth'],
  title: 'Orchestra',
  description:
    'The conducted score played by a sampled orchestra (spessasynth_lib + a cut MuseScore_General SF3): a pending-event scheduler on the conductor’s time, dynamics as CC11/CC74 on sounding notes. Off by default; loads only when switched on.',
  inputs: [
    { name: 'time', kind: 'musical-time', description: 'The conductor’s musical time (beat, tempo).' },
    { name: 'velocityScale', kind: 'number', default: 1, description: 'The conductor’s dynamics, 0..1: CC11 + CC74 on every channel.' },
    { name: 'articulation', kind: 'number', default: 0.5, description: 'The conductor’s articulation, 0 legato .. 1 staccato: shortens the next notes.' },
    { name: 'conducting', kind: 'boolean', default: false, description: 'The conductor is on: the orchestra plays.' },
    { name: 'doc', kind: 'score-doc', description: 'The loaded piece; none = the built-in demo scale.' },
    { name: 'config', kind: 'conductor-config', description: 'The conductor dial; its `orchestra` field switches the orchestra on and sets the levels.' },
    { name: 'claimed', kind: 'boolean', default: false, description: 'A tool (the Trainer) has claimed silence.' },
  ],
  outputs: [
    { name: 'status', kind: 'load-status' },
    { name: 'playing', kind: 'boolean', schema: z.boolean() },
  ],
  params: Params,
  make(p) {
    let resources: Record<string, unknown> = {};
    let log: ((msg: string) => void) | undefined;
    let configRef: unknown = Symbol('unset');
    let settings: OrchestraSettings = DEFAULT_ORCHESTRA;

    /** The synth the current plan's programs and levels were sent to. */
    let attached: OrchestraSynth | null = null;
    let docRef: unknown = Symbol('unset');
    let plan: OrchestraPlan | null = null;
    let scheduler: Scheduler | null = null;
    let wasPlaying = false;
    /** Last controller value sent per `channel:cc`, and when expression was last sent. */
    const sentCC = new Map<string, number>();
    let lastDynamicsAt = -Infinity;

    const synth = lazyResource<OrchestraSynth>({
      label: 'orchestra',
      load: ({ signal, progress }) => {
        const factory = (resources.createOrchestraEngine as OrchestraEngineFactory | undefined) ?? _defaultFactory;
        return factory({
          audioContext: resources.audioContext as AudioContext | undefined,
          destination: resources.masterGain as AudioNode | undefined,
          signal,
          progress,
        });
      },
      unload: (s) => {
        try {
          s.close();
        } finally {
          if (attached === s) attached = null;
        }
      },
      log: (m) => (log ?? console.warn)(m),
    });

    const sendCC = (s: OrchestraSynth, channel: number, cc: number, value: number, time: number): void => {
      const k = `${channel}:${cc}`;
      if (sentCC.get(k) === value) return;
      sentCC.set(k, value);
      s.controllerChange(channel, cc, value, time);
    };

    /** The context time each key's last onset / release was sent at. The scheduler keeps
     *  on and off alternating per key in ENGINE time; each tick maps engine time to the
     *  context afresh (`scheduleAt`), and a context clock that advances in large steps
     *  (big audio buffers) could otherwise land a release after the next onset it was
     *  meant to precede, or an onset after the release meant to cancel it. */
    const lastOnCtx = new Map<string, number>();
    const lastOffCtx = new Map<string, number>();
    /** The smallest gap kept between a key's onset and release on the context clock, s. */
    const ORDER_GAP = 0.001;

    /** Send scheduler commands (engine times) on the context clock, keeping per-key order. */
    const deliver = (s: OrchestraSynth, cmds: readonly ScheduleCommand[], clock: { currentTime: number }, nowEngine: number, stage: number): void => {
      for (const c of cmds) {
        const k = `${c.channel}:${c.key}`;
        let when = scheduleAt(clock, c.time, nowEngine, stage);
        if (c.type === 'noteOn') {
          when = Math.max(when, (lastOffCtx.get(k) ?? -Infinity) + ORDER_GAP);
          lastOnCtx.set(k, when);
          s.noteOn(c.channel, c.key, Math.max(1, to7bit(c.velocity)), when);
        } else {
          when = Math.max(when, (lastOnCtx.get(k) ?? -Infinity) + ORDER_GAP);
          lastOffCtx.set(k, when);
          s.noteOff(c.channel, c.key, when);
        }
      }
    };

    /**
     * Stop what is sounding. The scheduler's releases are engine-timed like every other
     * command and go through the same map: a release at (just after) a committed but not
     * yet started onset cancels it, which `allNotesOff` cannot do (spessasynth's stop
     * does not clear its queue of timed events).
     */
    const silence = (s: OrchestraSynth, clock: { currentTime: number }, nowEngine: number, stage: number): void => {
      const offs = scheduler?.stop(nowEngine) ?? [];
      deliver(s, offs, clock, nowEngine, stage);
      s.allNotesOff();
    };

    /** (Re)build the plan when the piece or the synth changed; send programs. */
    const ensurePlan = (s: OrchestraSynth, rawDoc: unknown, clock: { currentTime: number }, nowEngine: number, stage: number): void => {
      if (rawDoc === docRef && s === attached && plan) return;
      if (s !== attached) {
        lastOnCtx.clear();
        lastOffCtx.clear();
      }
      silence(s, clock, nowEngine, stage);
      if (rawDoc !== docRef || !plan) {
        docRef = rawDoc;
        const parsed = rawDoc && typeof rawDoc === 'object' ? ScoreDocSchema.safeParse(rawDoc) : null;
        plan = planPiece(parsed?.success ? (parsed.data as ScoreDoc) : null, { dynamics: p.dynamics });
      }
      scheduler = createScheduler(plan.events, { loopBeats: plan.loopBeats });
      attached = s;
      sentCC.clear();
      lastDynamicsAt = -Infinity;
      for (const ch of plan.channels) s.programChange(ch.channel, ch.program);
    };

    return {
      process(inputs, ctx: NodeContext) {
        resources = ctx.resources;
        log = ctx.log;
        if (inputs.config !== configRef) {
          configRef = inputs.config;
          settings = settingsOf(inputs.config);
        }
        const enabled = settings.enabled && realtimeOutputAllowed(ctx);
        synth.want(enabled);
        const s = synth.current();
        const status: LoadStatus = synth.status();
        if (!s) {
          scheduler = null;
          plan = null;
          docRef = Symbol('unset');
          wasPlaying = false;
          return { status, playing: false };
        }

        const ac = resources.audioContext as (AudioContext & { state?: string }) | undefined;
        const clock = ac ?? { currentTime: ctx.time };
        const stage = timingFrom(resources).outputStage.value;
        ensurePlan(s, inputs.doc, clock, ctx.time, stage);

        const conducting = inputs.conducting === true;
        const playing = conducting && inputs.claimed !== true;
        // Stopping releases everything; the levels below still go out, so the first
        // note after Start is already at the right level.
        if (!playing && wasPlaying) silence(s, clock, ctx.time, stage);
        wasPlaying = playing;

        // ---- levels: per-section volume (CC7), dynamics (CC11 + CC74), rate-limited ----
        const now = clock.currentTime;
        for (const ch of plan!.channels) sendCC(s, ch.channel, CC.volume, to7bit(settings.volume * settings.sections[ch.section]), now);
        if (ctx.time - lastDynamicsAt >= p.ccInterval) {
          lastDynamicsAt = ctx.time;
          const vs = typeof inputs.velocityScale === 'number' && conducting ? inputs.velocityScale : 1;
          const dyn = dynamicsControllers(vs, p.brightnessDepth);
          for (const ch of plan!.channels) {
            sendCC(s, ch.channel, CC.expression, dyn.expression, now);
            sendCC(s, ch.channel, CC.brightness, dyn.brightness, now);
          }
        }

        // A context that is not running has a frozen clock: commands scheduled on it
        // would burst out on resume. Hold the scheduler until it runs.
        const running = !ac || ac.state === undefined || ac.state === 'running';
        const time = inputs.time as MusicalTime | undefined;
        if (playing && running && time && Number.isFinite(time.beat) && scheduler) {
          const tick = Math.min(0.1, Math.max(1 / 240, ctx.dt || 1 / 60));
          const art = typeof inputs.articulation === 'number' ? inputs.articulation : 0.5;
          const cmds = scheduler.tick({
            now: ctx.time,
            beat: time.beat,
            bpm: time.tempo > 0 && Number.isFinite(time.tempo) ? time.tempo : 0,
            horizon: stage + p.lookaheadTicks * tick,
            durationScale: durationScaleFor(art, p.staccatoDepth),
          });
          deliver(s, cmds, clock, ctx.time, stage);
        }

        return { status: withActive(status, playing, 'Playing'), playing };
      },
      dispose() {
        // Unloading closes the synth, which destroys it with whatever it had queued.
        synth.dispose();
        attached = null;
        scheduler = null;
      },
    };
  },
});
