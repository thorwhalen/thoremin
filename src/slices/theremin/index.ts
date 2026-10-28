/**
 * The physical theremin slice: a theremin played through the physics of a real one (the research
 * and the model: `docs/research/theremin-physics.md`). Its node (`physical-theremin`), its branch,
 * its dial (`physicalTheremin`, one object), the antennas on the video (its overlay element), its
 * catalog row (a field instrument) and its seed, **Physical Theremin**; in its React half
 * (`./ui.tsx`) the editor section and the status the section reads.
 *
 * Listed in `extensions.json` like any extension, so the core-alone build carries none of it.
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, dialSlice, overlayElementId, overlayPortName } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import type { NodeDef } from '@thoremin/dag';
import { physicalThereminNode } from './nodes/physical_theremin';
import { ANTENNAS_ELEMENT, antennasElement } from './nodes/overlay/antennas';
import { DEFAULT_PHYSICAL_THEREMIN, PhysicalThereminSchema } from './schema';

export const PHYSICAL_THEREMIN_EXTENSION_ID = 'physical-theremin';
export const PHYSICAL_THEREMIN_BRANCH_ID = 'physical-theremin';
export const PHYSICAL_THEREMIN_NODE_ID = 'physTheremin';
/** The dial key, and the catalog row id the editor section is listed under. */
export const PHYSICAL_THEREMIN_DIAL = 'physicalTheremin';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const overlay = (port: string) => ({ node: TRUNK.overlay, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }) => ({ from, to: toRef });
const node = (port: string) => ({ node: PHYSICAL_THEREMIN_NODE_ID, port });

export const physicalTheremin = defineBranch({
  id: PHYSICAL_THEREMIN_BRANCH_ID,
  description: 'The physical theremin: the right hand on a virtual pitch rod (heterodyne LC physics), the left over a volume loop.',
  nodes: [{ id: PHYSICAL_THEREMIN_NODE_ID, type: 'physical-theremin', params: {} }],
  edges: [
    to({ node: TRUNK.hands, port: 'hands' }, node('hands')),
    to(ui(PHYSICAL_THEREMIN_DIAL), node('config')),
    to(ui('scaleRight'), node('scale')),
    to(ui('octaveShift'), node('octaveShift')),
    to(node('status'), overlay(overlayPortName(PHYSICAL_THEREMIN_EXTENSION_ID, ANTENNAS_ELEMENT, 'status'))),
  ],
  voices: [{ from: node('params'), role: 'instrument' }],
  overlay: [overlayElementId(PHYSICAL_THEREMIN_EXTENSION_ID, ANTENNAS_ELEMENT)],
});

const on = (s: Readonly<Record<string, unknown>>): boolean => (s[PHYSICAL_THEREMIN_DIAL] as { enabled?: boolean } | undefined)?.enabled === true;

export const PHYSICAL_THEREMIN_EXTENSION = defineExtension({
  id: PHYSICAL_THEREMIN_EXTENSION_ID,
  catalog: [
    // A field instrument: the hands in the camera's field play it. It snaps to the scale only with
    // the assistance up, but the scale is then the one the Sound section sets.
    { id: PHYSICAL_THEREMIN_DIAL, label: 'Physical theremin', emoji: '📡', class: 'field', usesScale: true, on },
  ],
  overlay: [
    { name: ANTENNAS_ELEMENT, category: 'guide', drawBefore: 'markers', inputs: [{ name: 'status', kind: 'physical-theremin-status' }], config: { dialKey: PHYSICAL_THEREMIN_DIAL } },
  ],
  overlayElements: [antennasElement],
  nodes: [physicalThereminNode] as unknown as NodeDef<unknown>[],
  branches: [physicalTheremin],
  dials: [
    dialSlice({
      version: 1,
      key: 'physicalTheremin',
      schema: PhysicalThereminSchema.default(DEFAULT_PHYSICAL_THEREMIN),
      kind: 'physical-theremin-config',
      meta: {
        facets: ['Physical theremin'],
        title: 'Physical theremin',
        description:
          'A theremin through its physics: on/off, where the pitch rod and the volume loop stand, the circuits (carrier, tank, zero beat, sensitivity, linearity), the sound and volume, and the assistance level with its pitch correction, scale snap, smoothing and vibrato aid',
      },
    }),
  ] as const,
  instruments: [
    // The right hand's distance AND shape play the pitch (open a finger, the pitch rises), the
    // left hand over the loop the volume. The theremin voices of the default map are silent, and
    // the note grid and the note names on the hands are hidden: the antennas are the guide.
    {
      name: 'Physical Theremin',
      patch: {
        handMap: { maxGain: 0 },
        overlay: { scaleGuide: { show: false }, markers: { showNotes: false } },
        [PHYSICAL_THEREMIN_DIAL]: { enabled: true },
      },
    },
  ],
  derive: (s) => (on(s as Readonly<Record<string, unknown>>) ? [PHYSICAL_THEREMIN_BRANCH_ID] : []),
});

export default PHYSICAL_THEREMIN_EXTENSION;
