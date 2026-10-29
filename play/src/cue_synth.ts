/**
 * The sounds a standalone game plays itself (reference notes, count-in clicks): one short
 * plucked tone per cue, started at the cue's context time. The app plays the same cues through
 * its plucked-string sink; a bare page needs nothing that heavy.
 */
import type { Cue } from '@thoremin/games/cues';

/** Decay to silence, seconds: a reference note rings, a click does not. */
const DECAY = { reference: 1.0, click: 0.06 } as const;

const hzOf = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export function playCue(ctx: AudioContext, dest: AudioNode, cue: Cue): void {
  const t = Math.max(cue.t, ctx.currentTime);
  const decay = DECAY[cue.kind];
  const osc = ctx.createOscillator();
  osc.type = cue.kind === 'click' ? 'square' : 'triangle';
  osc.frequency.value = hzOf(cue.midi);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.4 * cue.velocity, t + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  osc.connect(env).connect(dest);
  osc.start(t);
  osc.stop(t + decay + 0.02);
}
