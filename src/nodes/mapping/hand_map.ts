/**
 * The hand→sound mapping model — how wrist position and the per-finger→thumb
 * distances are routed to aspects of the sound. This is the configurable heart of an
 * "instrument" beyond scale/sound: the note SOURCE (index fingertip or the steadier
 * wrist), and a routing of each finger to a sound EFFECT from a small palette, each
 * with a sensitivity and a continuous/trigger mode.
 *
 * The design is grounded in the hand-control research (discussion #80): the most
 * controllable fingers (index) should drive the most perceptually salient sound
 * aspects (brightness), and coupled/coarse fingers (ring, pinky) the peripheral ones
 * (pan, pitch-bend) — so finger enslaving falls along congruent sonic dimensions.
 *
 * Pure + framework-agnostic (imports only domain types), so {@link fingerEffects} is
 * unit-tested directly; the {@link voiceMappingNode} applies its output, and the
 * settings layer builds a Zod schema over {@link EFFECTS} / {@link HandMap}.
 */
import { FINGER_NAMES, type FingerCloseness, type FingerName } from '@thoremin/sdk/nodes/domain';
import { EFFECTS, TRIGGER_THRESHOLD, type EffectId, type FingerRoute, type HandMap } from './hand_map.schema';
export { EFFECTS, EFFECT_SHORT, FINGER_MODES, POSITION_SOURCES, DEFAULT_HAND_MAP, RECOMMENDED_FINGER_ROUTES, TRIGGER_THRESHOLD, BEND_SEMITONES } from './hand_map.schema';
export type { EffectId, FingerTarget, FingerMode, FingerRoute, PositionSource, HandMap } from './hand_map.schema';

/**
 * Combine the finger routes into a per-effect amount. Each routed finger contributes
 * its (mode/invert/sensitivity-shaped) closeness to its target; fingers sharing a
 * target are AVERAGED — so routing several fingers to one effect gives the "combined
 * spread" the user described. Additive effects default to 0; `gate` (multiplicative)
 * defaults to 1 (pass-through) when no finger drives it. Pure.
 */
export function fingerEffects(fingers: FingerCloseness, routes: Record<FingerName, FingerRoute>): Record<EffectId, number> {
  const bucket: Partial<Record<EffectId, number[]>> = {};
  for (const name of FINGER_NAMES) {
    const r = routes[name];
    if (!r || r.target === 'none') continue;
    let c = fingers[name];
    if (r.mode === 'trigger') c = c > TRIGGER_THRESHOLD ? 1 : 0;
    if (r.invert) c = 1 - c;
    const amount = Math.max(0, Math.min(1, c * r.sensitivity));
    (bucket[r.target] ??= []).push(amount);
  }
  const out = {} as Record<EffectId, number>;
  for (const e of EFFECTS) {
    const a = bucket[e];
    out[e] = a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : e === 'gate' ? 1 : 0;
  }
  return out;
}
