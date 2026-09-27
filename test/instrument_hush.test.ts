/**
 * The instrument HUSH (round 4): the instrument goes quiet while the Trainer is open or
 * the conductor is on, and sounds again after — without touching the player's own mute.
 *
 * Covered end to end: the rule (`hushOf`), the store's claim set, `store-controls`
 * emitting it, `synth-merge` silencing every voice but the conducted score, the struck
 * instruments' schedulers dropping events, the graph wiring all of it (a hush port left
 * unconnected would be #120 again: a switch nothing reads), and the one-time migration
 * of the trainer HUD pref whose default flipped with the banner.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { replayNode } from '@/dag';
import { synthMergeNode } from '@/nodes';
import { drumOutNode, type DrumSink } from '@/extensions/air/nodes/drum_out';
import { pluckOutNode } from '@/extensions/air/nodes/pluck_out';
import { hushOf, storeControlsNode } from '@/nodes/sources/store_controls';
import type { SynthParams, VoiceParams } from '@/nodes';
import type { DrumHit } from '@/extensions/air/nodes/air_drum';
import { defaultGraph } from '@/app/graph';
import { useControls, migrateControls } from '@/app/store';

const voice = (id: number): VoiceParams => ({ id, present: true, freq: 440, gain: 0.5, sound: 'sine', brightness: 1, vibrato: 0, pan: 0 });
const params = (...ids: number[]): SynthParams => ({ voices: ids.map(voice) });

afterEach(() => {
  useControls.setState({ hushedBy: [], muted: false });
});

describe('hushOf: when the instrument goes quiet', () => {
  it('nobody claims and no conductor: nothing is hushed', () => {
    expect(hushOf({})).toEqual({ hushVoices: false, muteAll: false, muteStrikes: false, claimed: false });
    expect(hushOf({ hushedBy: [], conductor: { enabled: false } as never })).toEqual({ hushVoices: false, muteAll: false, muteStrikes: false, claimed: false });
  });

  it('a tool claim (the Trainer) silences everything: voices, the score, the struck instruments', () => {
    expect(hushOf({ hushedBy: ['trainer'] })).toEqual({ hushVoices: true, muteAll: true, muteStrikes: true, claimed: true });
    // Even with the conductor left on from earlier: its score must not play over the click.
    expect(hushOf({ hushedBy: ['trainer'], conductor: { enabled: true } as never }).muteAll).toBe(true);
  });

  it('the conductor hushes the active instrument, field or air, but keeps the score (muteAll stays off)', () => {
    expect(hushOf({ conductor: { enabled: true } as never })).toEqual({ hushVoices: true, muteAll: false, muteStrikes: true, claimed: false });
  });

  it('the player\'s M silences the struck instruments too (muteStrikes), not only the voices', () => {
    expect(hushOf({ muted: true })).toEqual({ hushVoices: false, muteAll: true, muteStrikes: true, claimed: false });
  });
});

describe('the store claim set', () => {
  it('is idempotent per claimer and lifts only when the LAST claim is released', () => {
    const { setHush } = useControls.getState();
    setHush('trainer', true);
    setHush('trainer', true);
    setHush('other', true);
    expect(useControls.getState().hushedBy).toEqual(['trainer', 'other']);
    setHush('trainer', false);
    expect(useControls.getState().hushedBy).toEqual(['other']);
    setHush('other', false);
    expect(useControls.getState().hushedBy).toEqual([]);
  });

  it('never touches the player\'s mute, either way', () => {
    useControls.getState().setMuted(true);
    useControls.getState().setHush('trainer', true);
    useControls.getState().setHush('trainer', false);
    expect(useControls.getState().muted).toBe(true);
  });

  it('store-controls emits the hush from the live store each tick', () => {
    const h = storeControlsNode.make(storeControlsNode.params.parse({}));
    const tick = () => h.process({}, { tick: 0, time: 0, dt: 1 / 30, resources: { controls: () => useControls.getState() } }) as Record<string, unknown>;
    expect(tick()).toMatchObject({ hushVoices: false, muteAll: false, muteStrikes: false, mute: false });
    useControls.getState().setHush('trainer', true);
    expect(tick()).toMatchObject({ hushVoices: true, muteAll: true, muteStrikes: true, mute: false });
    // The generative layer is not a merged voice: its level drops with the claim.
    expect(tick().steerVolume).toBe(0);
  });
});

describe('synth-merge hush', () => {
  it('silences every instrument voice but keeps the score pool (the conducted score)', async () => {
    const [out] = await replayNode(synthMergeNode.make({}), {
      voice1: [params(0, 1)],
      voice2: [params(2)],
      voice3: [params(6)],
      score1: [params(40)],
      voice4: [params(50)],
      hush: [true],
    });
    const byId = new Map((out.params as SynthParams).voices.map((v) => [v.id, v]));
    for (const id of [0, 1, 2, 6, 50]) {
      expect(byId.get(id)).toMatchObject({ gain: 0, present: false });
    }
    expect(byId.get(40)).toMatchObject({ gain: 0.5, present: true });
  });

  it('the master mute still silences the score too (the player\'s switch is total)', async () => {
    const [out] = await replayNode(synthMergeNode.make({}), { a: [params(0)], d: [params(40)], mute: [true], hush: [false] });
    expect((out.params as SynthParams).voices.every((v) => v.gain === 0 && !v.present)).toBe(true);
  });
});

describe('the struck instruments drop their events while hushed', () => {
  const ac = { currentTime: 10, state: 'running' };

  it('drum-out', () => {
    const played: unknown[] = [];
    const sink: DrumSink = { play: (...a) => void played.push(a), close: () => {} };
    const h = drumOutNode.make({});
    const ctx = { tick: 1, time: 100, dt: 1 / 60, resources: { audioContext: ac, masterGain: {}, createDrumSink: () => sink, timeScale: 1 } };
    const hit: DrumHit = { t: 100.05, velocity: 0.7, hand: 'right', sound: 'kick', predicted: true, lead: 0.05, pull: 0 };
    h.process({ hits: [hit], mute: true }, ctx as never);
    expect(played).toHaveLength(0);
    h.process({ hits: [hit], mute: false }, ctx as never);
    expect(played).toHaveLength(1);
  });

  it('pluck-out', () => {
    const played: unknown[] = [];
    const h = pluckOutNode.make(pluckOutNode.params.parse({}));
    const ctx = {
      tick: 1,
      time: 5,
      dt: 1 / 30,
      resources: { audioContext: ac, masterGain: {}, createPluckSink: () => ({ play: (...a: unknown[]) => void played.push(a), close: () => {} }) },
    };
    const notes = [{ t: 5.05, midi: 40, velocity: 0.8, predicted: true, lead: 0.05 }];
    h.process({ notes, mute: true }, ctx as never);
    expect(played).toHaveLength(0);
    h.process({ notes }, ctx as never);
    expect(played).toHaveLength(1);
  });
});

describe('the default graph wires the hush (a switch nothing reads is #120 again)', () => {
  const edges = defaultGraph().edges;
  const has = (fn: string, fp: string, tn: string, tp: string) =>
    edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);

  it('the merge\'s two switches, and the all-mute at every struck scheduler', () => {
    expect(has('ui', 'hushVoices', 'merge', 'hush')).toBe(true);
    expect(has('ui', 'muteAll', 'merge', 'mute')).toBe(true);
    for (const out of ['drumOut', 'bassOut', 'guitarOut']) expect(has('ui', 'muteStrikes', out, 'mute')).toBe(true);
  });

  it('the conducted score is on the merge port the hush spares', () => {
    expect(has('score', 'params', 'merge', 'score1')).toBe(true);
  });
});

describe('the trainer HUD pref migration (v18)', () => {
  it('carries a returning player\'s old default (show: true) to the new default, once', () => {
    const migrated = migrateControls({ trainerHud: { show: true, position: 'bottom' } }, 17) as unknown as { trainerHud: { show: boolean; position: string } };
    expect(migrated.trainerHud).toEqual({ show: false, position: 'bottom' });
    // A v18 blob is the player's own choice: left alone.
    const kept = migrateControls({ trainerHud: { show: true, position: 'top' } }, 18) as unknown as { trainerHud: { show: boolean } };
    expect(kept.trainerHud.show).toBe(true);
  });
});
