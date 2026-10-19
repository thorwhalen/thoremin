/**
 * The conductor slice's branch (#187; a slice since #600 S18b): the conductor node, the score it
 * leads and the sampled orchestra, with the overlay's conductor readout. Its node ids and ports
 * (`conductor`, `time`, `leadsScore`, `velocityScale`, `recordingTime`, `transportPose`) are what
 * the song slice, the air extension's chord chart and the faces extension's pose transport name.
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import { DEMO_LOOP_BEATS, DEMO_SCALE_NOTES } from '@thoremin/sdk/score/demo';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const overlay = (port: string) => ({ node: TRUNK.overlay, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }, optional = false) =>
  optional ? { from, to: toRef, optional: true } : { from, to: toRef };

/** The sampled orchestra's node id in the conductor branch: the one place it is written
 *  (the engine loop's status reporter reads the node by it, `./app/orchestraStatus.ts`). */
export const ORCHESTRA_NODE_ID = 'orchestra';

export const conductor = defineBranch({
  id: 'conductor',
  description: 'Conducting: the ictus detector, the conducted score it drives, and the sampled orchestra that can play it.',
  nodes: [
    { id: 'conductor', type: 'conductor', params: {} },
    { id: 'score', type: 'score', params: { notes: DEMO_SCALE_NOTES, loopBeats: DEMO_LOOP_BEATS, baseGain: 0.4, sound: 'triangle' } },
    // The sampled orchestra (#187 PR 5): off until `conductor.orchestra.enabled`, and
    // loads nothing until then; takes the piece over from `score` once it is ready.
    { id: ORCHESTRA_NODE_ID, type: 'orchestra', params: {} },
  ],
  edges: [
    to({ node: TRUNK.cam, port: 'hands' }, { node: 'conductor', port: 'hands' }),
    // The body conductor (#375): the pose stream, present when the derivation composes the
    // body source (it does while `conductor.source` is `body`; a structural test pins that).
    to({ node: 'camBody', port: 'body' }, { node: 'conductor', port: 'body' }, true),
    // The dancer leading the score (#380): the dancer's pulse, present with the body source
    // (composed while `conductor.source` is `dancer`).
    to({ node: 'bodyPulse', port: 'pulse' }, { node: 'conductor', port: 'pulse' }, true),
    to(ui('conductor'), { node: 'conductor', port: 'config' }),
    to({ node: 'conductor', port: 'beat' }, { node: 'score', port: 'beat' }),
    to({ node: 'conductor', port: 'velocityScale' }, { node: 'score', port: 'velocityScale' }),
    to({ node: 'conductor', port: 'leadsScore' }, { node: 'score', port: 'enabled' }),
    to(ui('scoreDoc'), { node: 'score', port: 'doc' }),
    // The part selection (#471): the one dial, `conductor.parts`, read by BOTH players from
    // the conductor config, so the score node and the orchestra cannot disagree.
    to(ui('conductor'), { node: 'score', port: 'config' }),
    to(ui('scoreDoc'), { node: 'conductor', port: 'doc' }),
    // The player's lead offsets (#427, a per-device pref): read only on the body's path.
    to(ui('conductorLeadOffsets'), { node: 'conductor', port: 'leadOffsets' }),
    to({ node: 'conductor', port: 'time' }, overlay('conductorTime')),
    to({ node: 'conductor', port: 'enabled' }, overlay('conductorEnabled')),
    to({ node: 'conductor', port: 'time' }, { node: ORCHESTRA_NODE_ID, port: 'time' }),
    to({ node: 'conductor', port: 'velocityScale' }, { node: ORCHESTRA_NODE_ID, port: 'velocityScale' }),
    to({ node: 'conductor', port: 'articulation' }, { node: ORCHESTRA_NODE_ID, port: 'articulation' }),
    to({ node: 'conductor', port: 'leadsScore' }, { node: ORCHESTRA_NODE_ID, port: 'conducting' }),
    to(ui('scoreDoc'), { node: ORCHESTRA_NODE_ID, port: 'doc' }),
    to(ui('conductor'), { node: ORCHESTRA_NODE_ID, port: 'config' }),
    to(ui('claimed'), { node: ORCHESTRA_NODE_ID, port: 'claimed' }),
    to({ node: ORCHESTRA_NODE_ID, port: 'playing' }, { node: 'score', port: 'replaced' }),
  ],
  voices: [{ from: { node: 'score', port: 'params' }, role: 'score' }],
  overlay: ['conductorHud'],
  // One hand at a time: the beating hand (`pickHand`), or the shaping hand while the body
  // beats. Which one depends on the hands in view, so `HAND_COUNT_POLICY` decides (#325).
  // The split with the hands alone (#457) reads two at once: a dial, so the host says so
  // (`HandCountContext.twoHandsRead`, from `conductorReadsTwoHands`).
  hands: 1,
});
