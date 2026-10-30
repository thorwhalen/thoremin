/**
 * The Feature Lab slice (#600 S16b; #119, #136, #150): the measuring tool that draws the raw face,
 * hand and body features as live, online-normalized meters over the video, with derived formulas,
 * a rolling correlation matrix and saved views. Moved out of core whole: its config was a core
 * device pref, its two overlay elements core's, its statistics computed inside the overlay node.
 *
 * Its config is the slice's per-device pref (`featureLab`, the key it always had), never an
 * instrument's. While the meters are shown the Lab claims the groups it shows as a feature demand
 * (S16a), which is what composes their sources and gates the vector nodes; core reads only the
 * demand. Its overlay element reads the config from a derived port and the three vectors on edges of
 * a branch that joins the trunk (the face and body ones optional: present while their sources are).
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, overlayElementId, overlayPortName } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import { FeatureLabSchema, LAB_PREF, type FeatureLabConfig } from './schema';
import { labMeters, LAB_METERS_DECL, LAB_METERS_ELEMENT } from './nodes/meters';
import { LAB_STORES } from './stores';

export const LAB_EXTENSION_ID = 'feature-lab';
export const LAB_METERS_BRANCH = 'lab-meters';
/** The derived port carrying the Lab's whole config to its overlay element. */
export const LAB_CONFIG_PORT = 'featureLabConfig';

const port = (input: string) => ({ node: TRUNK.overlay, port: overlayPortName(LAB_EXTENSION_ID, LAB_METERS_ELEMENT, input) });

/** The meters' inputs. The vector nodes are core's: the hand vector is the trunk's; the face and
 *  body ones exist while their source branches are composed, so their edges are optional. */
export const LAB_METERS = defineBranch({
  id: LAB_METERS_BRANCH,
  description: 'The Feature Lab: live, normalized meters over the raw feature vectors.',
  nodes: [],
  edges: [
    { from: { node: TRUNK.ui, port: LAB_CONFIG_PORT }, to: port('lab') },
    { from: { node: 'handVec', port: 'vector' }, to: port('hand') },
    { from: { node: 'faceVec', port: 'vector' }, to: port('face'), optional: true },
    { from: { node: 'bodyVec', port: 'vector' }, to: port('body'), optional: true },
  ],
  overlay: [overlayElementId(LAB_EXTENSION_ID, LAB_METERS_ELEMENT)],
});

export const LAB_EXTENSION = defineExtension({
  id: LAB_EXTENSION_ID,
  nodes: [],
  branches: [LAB_METERS],
  dials: [] as const,
  prefs: [{ key: LAB_PREF, liveInTab: true, schema: FeatureLabSchema, ports: [{ name: LAB_CONFIG_PORT, kind: 'feature-lab-config', read: (p: FeatureLabConfig) => p }] }],
  overlay: [LAB_METERS_DECL],
  overlayElements: [labMeters],
  stores: Object.values(LAB_STORES),
  // The meters are always composed (idle, an early return, until shown), as core's elements were.
  trunk: [LAB_METERS_BRANCH],
  derive: () => [],
});

export default LAB_EXTENSION;
