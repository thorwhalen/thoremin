/**
 * `music-scale` node: the interposer on the bridge's five scale ports (rule 6 of `composeGraph`).
 * It passes the dials' scales through untouched while the dials own the scale; while the
 * `music-context` node hands it a key (same tick, so the key is the one the playing position has
 * reached), it emits the five ports computed from the dials with that key in place of theirs
 * (`scalePortsInKey`): both hands' melody scales fitted to the key, their register kept, and the
 * chord source pinned to the key's seven notes. The dials themselves are never written.
 *
 * The dials are read from the bridge's snapshot (`ctx.resources.controls`, the getter
 * `store-controls` reads), since a port carries only the right hand's spec; a cache keyed by the
 * snapshot and the key spares the arithmetic on ticks where neither changed. A host with no such
 * getter (a headless run that replays the bridge) gets the dials' scales passed through: the music
 * cannot own a scale whose dials it cannot read.
 */
import { z } from 'zod';
import { defineNode, type NodeContext } from '@thoremin/dag';
import { SCALE_PORTS, scalePortsInKey, type ScaleDials, type ScaleOverride, type ScalePortValues } from '@thoremin/sdk/context/scale';

const Params = z.object({});

const PORT_KINDS: Readonly<Record<(typeof SCALE_PORTS)[number], string>> = {
  scaleRight: 'number[]',
  scaleLeft: 'number[]',
  rightSpec: 'scale-spec',
  chordSpec: 'scale-spec',
  chordScale: 'number[]',
};

export const musicScaleNode = defineNode<z.infer<typeof Params>>({
  type: 'music-scale',
  roles: ['music', 'control'],
  title: 'Scale from the music',
  description: "Stands on the instrument's scales: passes the settings' scales through, or, while the instrument follows the music, the same scales in the music's key.",
  inputs: [{ name: 'override', kind: 'scale-override' }, ...SCALE_PORTS.map((name) => ({ name, kind: PORT_KINDS[name] }))],
  outputs: SCALE_PORTS.map((name) => ({ name, kind: PORT_KINDS[name] })),
  params: Params,
  make() {
    let lastDials: unknown = null;
    let lastKey = '';
    let last: ScalePortValues | null = null;
    return {
      process(inputs, ctx: NodeContext) {
        const pass = () => Object.fromEntries(SCALE_PORTS.map((p) => [p, inputs[p]]));
        const override = (inputs.override as ScaleOverride | null | undefined) ?? null;
        const getter = ctx.resources.controls as (() => ScaleDials) | undefined;
        if (!override || !getter) return pass();
        const dials = getter();
        if (!dials?.right || !dials.left) return pass();
        const key = `${override.key.tonic}|${override.key.mode}|${override.fit}`;
        if (!last || dials !== lastDials || key !== lastKey) {
          last = scalePortsInKey(dials, override);
          lastDials = dials;
          lastKey = key;
        }
        return { ...last };
      },
    };
  },
});
