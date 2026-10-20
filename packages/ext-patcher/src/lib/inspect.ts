/**
 * Which settings feed a node of the live graph (#14): what the patcher's inspector shows and edits.
 *
 * A node's tunable values are not its spec params (those are build-time defaults, fixed while the
 * graph runs); they are dials, which reach the node on edges from the host's `store-controls` node
 * (the trunk's `ui`). Most of its ports carry one dial under the dial's own key (`overlay`,
 * `conductor`, every extension's whole-object slice: `airDrum`), so a port names its settings.
 * Others carry a dial stored under another key: a flat dial (`magnetism` is `master.magnetism`) or
 * a value derived from several (`scaleRight` from the `right` voice). {@link DERIVED_PORT_DIALS}
 * names those, as data, and a test holds every alias the shipped graph uses to a real dial.
 * A port that matches no dial (a device pref, a transient, the hush) is shown as read-only.
 *
 * Pure: no React, no host; the inspector hands it the dials form's field keys.
 */
import type { EdgeSpec, GraphSpec } from '@thoremin/dag';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';

/** The `store-controls` ports whose value is derived from dials stored under other keys. */
export const DERIVED_PORT_DIALS: Readonly<Record<string, readonly string[]>> = {
  scaleRight: ['right'],
  soundRight: ['right.sound'],
  rightSpec: ['right.root', 'right.type'],
  scaleLeft: ['left'],
  soundLeft: ['left.sound'],
  chordSpec: ['faceChord.chordSource', 'faceChord.chordRoot', 'faceChord.chordType', 'right.root', 'right.type'],
  chordScale: ['faceChord.chordSource', 'faceChord.chordRoot', 'faceChord.chordType', 'right.root', 'right.type'],
  chordConfig: ['faceChord'],
  octaveShift: ['master.octaveShift'],
  magnetism: ['master.magnetism'],
  faceMapping: ['face.mapping'],
  expressionSensitivity: ['faceExpr.sensitivity'],
  expressionDegrees: ['faceExpr.degrees'],
  expressionTargets: ['faceExpr.targets'],
  handednessDwell: ['hands.handednessDwell'],
  // Flat extension dials whose slice derives a port under another name (`DialSlice.ports`).
  midiEnabled: ['midi.enabled'],
  midiPort: ['midi.port'],
  midiMuteFollowsMaster: ['midi.muteFollowsMaster'],
  steerEnabled: ['steer.enabled'],
  steerVolume: ['steer.volume'],
};

/** One input of a node fed by the settings, with the dial keys it reads (none: read-only). */
export interface SettingsFeed {
  port: string;
  /** The node's input port it arrives on. */
  into: string;
  keys: string[];
}

export interface InspectOptions {
  /** The id of the node that bridges the settings into the graph. */
  controlsNode?: string;
  aliases?: Readonly<Record<string, readonly string[]>>;
}

/** The dial keys among `fieldKeys` a settings port names: the key itself or its leaves, else its aliases. */
export function dialsForPort(port: string, fieldKeys: readonly string[], { aliases = DERIVED_PORT_DIALS }: Pick<InspectOptions, 'aliases'> = {}): string[] {
  const under = (root: string) => fieldKeys.filter((k) => k === root || k.startsWith(`${root}.`));
  const direct = under(port);
  if (direct.length) return direct;
  return [...new Set((aliases[port] ?? []).flatMap(under))];
}

/** Every settings port that feeds `nodeId`, with the dials it reads, in the spec's edge order. */
export function settingsFeeding(spec: Pick<GraphSpec, 'edges'>, nodeId: string, fieldKeys: readonly string[], { controlsNode = TRUNK.ui, aliases = DERIVED_PORT_DIALS }: InspectOptions = {}): SettingsFeed[] {
  return spec.edges
    .filter((e) => e.from.node === controlsNode && e.to.node === nodeId)
    .map((e) => ({ port: e.from.port, into: e.to.port, keys: dialsForPort(e.from.port, fieldKeys, { aliases }) }));
}

/** A node's wiring as the inspector lists it: what arrives on each input, what leaves each output. */
export function wiringOf(spec: Pick<GraphSpec, 'edges'>, nodeId: string): { inputs: EdgeSpec[]; outputs: EdgeSpec[] } {
  return {
    inputs: spec.edges.filter((e) => e.to.node === nodeId),
    outputs: spec.edges.filter((e) => e.from.node === nodeId),
  };
}

/** A live port value, in one short line (the inspector polls it a few times a second). */
export function summarize(value: unknown, { maxLength = 60 }: { maxLength?: number } = {}): string {
  if (value === undefined) return '(nothing)';
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === 'boolean' || typeof value === 'string') return String(value).slice(0, maxLength);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') {
    let text: string;
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = `{${Object.keys(value).join(', ')}}`;
    }
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }
  return typeof value;
}
