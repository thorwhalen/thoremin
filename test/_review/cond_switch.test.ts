import { it } from 'vitest';
import { conductorNode, DEFAULT_CONDUCTOR_DIAL } from '@/nodes';
import { UNKNOWN_PULSE, type PulseState } from '@thoremin/ictus';
const HZ = 30;
function pulseAt(t: number, period: number, t0 = 0.3): PulseState {
  const beat = (t - t0) / period;
  return { ...UNKNOWN_PULSE, t, beat, phase: beat - Math.floor(beat), tempo: 60 / period, period, confidence: 0.8, nextBeatAt: NaN, state: 'running', anchors: 10, level: period, lastAnchorAt: t0 + Math.floor(beat) * period } as PulseState;
}
const DEMO_44 = { v: 1, title: 'demo', source: 'builtin', parts: [], tempoMap: [{ beat: 0, bpm: 120 }], timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }], dynamics: [], fermatas: [6.5], lengthBeats: 64 };
it('switch dancer -> hands -> dancer mid piece; fermata; expression hands', async () => {
  const node: any = conductorNode.make(conductorNode.params.parse({ ...DEFAULT_CONDUCTOR_DIAL, enabled: true, source: 'dancer' }));
  let last = -Infinity; const log: string[] = [];
  const cfgs: Record<string, any> = {
    dancer: { ...DEFAULT_CONDUCTOR_DIAL, enabled: true, source: 'dancer' },
    hands: { ...DEFAULT_CONDUCTOR_DIAL, enabled: true, source: 'hands' },
    dancerHandsExpr: { ...DEFAULT_CONDUCTOR_DIAL, enabled: true, source: 'dancer', expression: 'hands' },
  };
  for (let i = 0; i < 40 * HZ; i++) {
    const t = i / HZ;
    const which = t < 12 ? 'dancer' : t < 18 ? 'hands' : t < 28 ? 'dancer' : 'dancerHandsExpr';
    const out = node.process({ config: cfgs[which], pulse: pulseAt(t, 2), doc: DEMO_44, hands: undefined, body: undefined }, { tick: i, time: t, dt: i ? 1 / HZ : 0, resources: {}, log: () => {} });
    if (out.beat < last - 1e-9) log.push(`BACKWARDS at ${t.toFixed(2)}: ${last.toFixed(3)} -> ${out.beat.toFixed(3)}`);
    last = out.beat;
    if (i % HZ === 0) log.push(`${t}:${which} b${out.beat.toFixed(2)} bpm${out.bpm.toFixed(0)} lead${out.leadsScore ? 1 : 0} st:${out.time.state} v${out.velocityScale.toFixed(2)} a${out.articulation.toFixed(2)}`);
  }
  console.log(log.join('\n'));
});
