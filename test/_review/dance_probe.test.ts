import { it } from 'vitest';
import { createDanceLead, UNKNOWN_PULSE, type PulseState } from '@thoremin/ictus';
const HZ = 30;
function pulseAt(t: number, period: number, t0 = 0, confidence = 0.8, beatShift = 0): PulseState {
  const beat = (t - t0) / period + beatShift;
  return { ...UNKNOWN_PULSE, t, beat, phase: beat - Math.floor(beat), tempo: 60 / period, period, confidence, nextBeatAt: NaN, state: 'running', anchors: 10, level: period } as PulseState;
}
it('A: armed, pause, resume with re-anchored pulse', () => {
  const lead = createDanceLead();
  let st;
  for (let i = 0; i < 3.5 * HZ; i++) st = lead.step({ t: i / HZ, pulse: pulseAt(i / HZ, 2, 0.3), marked: 120 });
  console.log('A at 3.5', st!.mode, st!.started);
  for (let i = 3.5 * HZ; i < 4 * HZ; i++) st = lead.step({ t: i / HZ, pulse: { ...pulseAt(i / HZ, 2, 0.3), confidence: 0.05 }, marked: 120 });
  console.log('A paused', st!.mode, st!.started);
  // resume: pulse follower re-anchored, its beat count now 7.6 (phase 0.6)
  for (let i = 4 * HZ; i < 4.2 * HZ; i++) { st = lead.step({ t: i / HZ, pulse: pulseAt(i / HZ, 2, 4 - 0.6 * 2, 0.8, 5), marked: 120 }); if (st.started) { console.log('A started at', i / HZ, 'beat', st.beat.toFixed(3), 'mode', st.mode); break; } }
});
it('B: time backwards', () => {
  const lead = createDanceLead();
  let st;
  for (let i = 0; i < 10 * HZ; i++) st = lead.step({ t: i / HZ, pulse: pulseAt(i / HZ, 2, 0.3), marked: 120 });
  const b0 = st!.beat;
  lead.step({ t: 5, pulse: pulseAt(5, 2, 0.3), marked: 120 });
  st = lead.step({ t: 10, pulse: pulseAt(10, 2, 0.3), marked: 120 });
  console.log('B beat jump over t 10->5->10:', (st.beat - b0).toFixed(2), 'beats (expected ~0)');
});
it('C: ratio switch 2s->1s cycle', () => {
  const lead = createDanceLead();
  let st; const log: string[] = [];
  for (let i = 0; i < 40 * HZ; i++) {
    const t = i / HZ;
    const p = t < 20 ? pulseAt(t, 2, 0.3) : pulseAt(t, 1.0, 0.3);
    st = lead.step({ t, pulse: p, marked: 120 });
    if (i % (2 * HZ) === 0) log.push(`${t.toFixed(0)}:${st.mode},k${st.ratio},${st.tempo.toFixed(1)},pe${st.phaseError.toFixed(2)},b${st.beat.toFixed(2)}`);
  }
  console.log('C', log.join(' | '));
});
it('D: tempo map change 120->60 at beat 40', () => {
  const lead = createDanceLead();
  let st; const log: string[] = [];
  for (let i = 0; i < 50 * HZ; i++) {
    const t = i / HZ;
    const marked = (st?.beat ?? 0) >= 40 ? 60 : 120;
    st = lead.step({ t, pulse: pulseAt(t, 2, 0.3), marked });
    if (i % (2 * HZ) === 0) log.push(`${t.toFixed(0)}:${st.mode},k${st.ratio},${st.tempo.toFixed(1)},pe${st.phaseError.toFixed(2)}`);
  }
  console.log('D', log.join(' | '));
});
it('E: time signature ref shift (3/4 bar inserted at beat 40, ref 40->43)', () => {
  const lead = createDanceLead();
  let st; const log: string[] = [];
  for (let i = 0; i < 60 * HZ; i++) {
    const t = i / HZ;
    const b = st?.beat ?? 0;
    const ref = b >= 43 ? 43 : b >= 40 ? 40 : 0;
    st = lead.step({ t, pulse: pulseAt(t, 2, 0.3), marked: 120, ref });
    if (i % (2 * HZ) === 0) log.push(`${t.toFixed(0)}:${st.mode},pe${st.phaseError.toFixed(2)},inBar${(((st.beat - (st.beat>=43?43:0)) % 4 + 4) % 4).toFixed(2)}`);
  }
  console.log('E', log.join(' | '));
});
it('F: dancer slower by 9% within clamp but phase near edge', () => {
  const lead = createDanceLead();
  let st; const log: string[] = [];
  for (let i = 0; i < 60 * HZ; i++) { const t = i / HZ; st = lead.step({ t, pulse: pulseAt(t, 2 / 0.91, 0.3), marked: 120 }); if (i % (5 * HZ) === 0) log.push(`${t}:${st.mode},${st.tempo.toFixed(1)},pe${st.phaseError.toFixed(2)}`); }
  console.log('F', log.join(' | '));
});
