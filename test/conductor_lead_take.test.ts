/**
 * A "Learn my timing" take (#427) end to end without a camera: the trainer's click plan,
 * the sink reading body frames from a stub engine, the result, and the host keeping it in
 * the per-device pref the conductor reads (`store-controls`' `conductorLeadOffsets`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setClickPlayer } from '@thoremin/sdk-ui/enroll/click';
import { cancelLeadTake, leadTakeBpm, leadTakeClicks, makeLeadCalibrationSink, startLeadTake, useLeadCalibration, LEAD_TAKE } from '@/app/conductorLead';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { demandWantsBody } from '@/features/groups';
import { conductorLeadHost } from '@/app/commands/conductorLeadHost';
import '@/app/conductorLeadHost';
import { useControls } from '@/app/store';
import { conduct } from './helpers/body_conduct';

const FPS = 30;
const LATE = 0.06;

afterEach(() => {
  cancelLeadTake();
  useControls.getState().setConductorLeadOffsets({});
  setClickPlayer(null);
});

describe('the take', () => {
  it("the trainer's plan: a bar's count-in, then the beats the take reads", () => {
    const { clicks, beats, startT, endT } = leadTakeClicks(80, 0);
    expect(clicks).toHaveLength(LEAD_TAKE.countIn + LEAD_TAKE.beats);
    expect(beats).toHaveLength(LEAD_TAKE.beats);
    expect(startT).toBeCloseTo(LEAD_TAKE.leadInMs / 1000, 9);
    expect(beats[0]).toBeCloseTo(startT + LEAD_TAKE.countIn * 0.75, 9);
    expect(endT).toBeCloseTo(beats[beats.length - 1] + 0.375, 9);
  });

  it('a player 60 ms behind the click: the wrist is learned late by 60 ms, kept, and reaches the conductor port', () => {
    const play = vi.fn();
    setClickPlayer({ play, stop: vi.fn() });
    startLeadTake({ bpm: 80, point: 'wrist', side: 'right', nowMs: 0 });
    expect(play).toHaveBeenCalledTimes(1);
    const take = useLeadCalibration.getState().take!;
    expect(take.joints).toEqual(['wrist']);
    // Strokes at the take's tempo whose every ictus lands LATE after a beat click.
    const first = take.beats[0] + LATE;
    const sc = conduct([{ kind: 'rest', s: 1 }, { kind: 'ready', s: first - 1.6 }, { kind: 'upbeat', s: 0.6 }, { kind: 'beat', bpm: 80, beats: LEAD_TAKE.beats + 1 }], { fps: FPS });
    let i = 0;
    const engine = { getOutput: (node: string, port: string) => (node === 'camBody' && port === 'body' ? sc.frames[i] : undefined) };
    const sink = makeLeadCalibrationSink(engine);
    for (; i < sc.frames.length && useLeadCalibration.getState().phase === 'listening'; i++) sink((i / FPS) * 1000);
    const s = useLeadCalibration.getState();
    expect(s.phase).toBe('done');
    expect(s.clicksPast).toBe(LEAD_TAKE.beats);
    expect(s.result!.offsets.wrist).toBeGreaterThan(LATE - 0.02);
    expect(s.result!.offsets.wrist).toBeLessThan(LATE + 0.02);

    // Keep merges: a joint this take did not measure keeps the offset it had.
    useControls.getState().setConductorLeadOffsets({ trunk: 0.05 });
    const kept = conductorLeadHost().keep();
    expect(kept).toEqual({ trunk: 0.05, ...s.result!.offsets });
    expect(useControls.getState().conductorPrefs.leadOffsets).toEqual(kept);
    expect(useLeadCalibration.getState().phase).toBe('idle');
    conductorLeadHost().clear();
    expect(useControls.getState().conductorPrefs.leadOffsets).toEqual({});
  });

  it('nothing is learned while no take runs, and a cancelled take leaves nothing to keep', () => {
    const engine = { getOutput: () => undefined };
    const sink = makeLeadCalibrationSink(engine);
    sink(1000);
    expect(useLeadCalibration.getState().phase).toBe('idle');
    setClickPlayer({ play: vi.fn(), stop: vi.fn() });
    startLeadTake({ bpm: 80, point: 'impact', side: 'auto', nowMs: 0 });
    cancelLeadTake();
    expect(conductorLeadHost().keep()).toBeNull();
  });

  it('a take during which a click was dropped is refused; a take that measured nothing keeps nothing', () => {
    let dropped = 0;
    setClickPlayer({ play: vi.fn(), stop: vi.fn(), dropped: () => dropped });
    startLeadTake({ bpm: 80, point: 'wrist', side: 'right', nowMs: 0 });
    const take = useLeadCalibration.getState().take!;
    const sink = makeLeadCalibrationSink({ getOutput: () => undefined });
    sink(1000);
    dropped = 1;
    sink(take.endT * 1000 + 1);
    expect(useLeadCalibration.getState().phase).toBe('done');
    expect(useLeadCalibration.getState().failure).toBe('clicks');
    expect(conductorLeadHost().keep()).toBeNull();
    // No frames at all: every joint refused, nothing to keep, nothing wiped.
    cancelLeadTake();
    useControls.getState().setConductorLeadOffsets({ trunk: 0.05 });
    dropped = 0;
    startLeadTake({ bpm: 80, point: 'wrist', side: 'right', nowMs: 0 });
    sink(take.endT * 1000 + 1);
    expect(useLeadCalibration.getState().result!.offsets).toEqual({});
    expect(useLeadCalibration.getState().result!.refused.wrist).toBe('anchors');
    expect(conductorLeadHost().keep()).toBeNull();
    expect(useControls.getState().conductorPrefs.leadOffsets).toEqual({ trunk: 0.05 });
  });

  it('the take claims the body camera for its length', () => {
    setClickPlayer({ play: vi.fn(), stop: vi.fn() });
    startLeadTake({ bpm: 80, point: 'impact', side: 'auto', nowMs: 0 });
    expect(demandWantsBody(appFeatureDemand.groups())).toBe(true);
    cancelLeadTake();
    expect(demandWantsBody(appFeatureDemand.groups())).toBe(false);
  });

  it("the take tempo: the piece's, inside 60..160 bpm", () => {
    expect(leadTakeBpm(null)).toBe(LEAD_TAKE.bpm);
    expect(leadTakeBpm(40)).toBe(60);
    expect(leadTakeBpm(200)).toBe(160);
    expect(leadTakeBpm(96.4)).toBe(96);
  });

  it('the store refuses an offset past half a second', () => {
    useControls.getState().setConductorLeadOffsets({ trunk: 0.05 });
    useControls.getState().setConductorLeadOffsets({ trunk: 0.9 });
    expect(useControls.getState().conductorPrefs.leadOffsets).toEqual({ trunk: 0.05 });
  });
});
