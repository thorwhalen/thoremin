/**
 * Verifies the real production sound graph (the one the browser app runs)
 * is structurally valid and ticks cleanly headlessly — no camera, audio, or DOM.
 * This catches wiring mistakes (bad port names, fan-in, cycles) in CI without a
 * browser. The webcam node lazy-loads TF.js inside init(), which we never call
 * here, so the app registry is Node-importable.
 */
import { describe, it, expect } from 'vitest';
import { FLUTE_VOICE_ID } from '@thoremin/ext-air/nodes/air_flute';
import { CHORD_MAP_MELODY_VOICE_ID, CHORD_MAP_VOICE_ID_BASE } from '@thoremin/ext-air/nodes/chord_map';
import { CHORD_WHEEL_VOICE_ID_BASE } from '@thoremin/ext-air/nodes/chord_wheel';
import { FEATURE_VECTOR_EDGES } from '@/app/enroll/liveVector';
import { Engine, StreamRecorder } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import type { SynthParams } from '@/nodes';
import { AIR, ASL, FACES } from './helpers/extensions';

describe('production app graph', () => {
  it('builds with a valid topology', () => {
    const engine = new Engine(defaultGraph(), createAppRegistry());
    const order = engine.evaluationOrder();
    // sources must precede mapping which (via the merge) must precede synth
    expect(order.indexOf('cam')).toBeLessThan(order.indexOf('feat'));
    expect(order.indexOf('feat')).toBeLessThan(order.indexOf('map'));
    expect(order.indexOf('map')).toBeLessThan(order.indexOf('merge'));
    expect(order.indexOf('merge')).toBeLessThan(order.indexOf('synth'));
    // #90: keyboard signals (octave / magnetism / mute) now flow from the store
    // via `ui` (store-controls), a source that precedes the mapping/merge it feeds.
    expect(order.indexOf('ui')).toBeLessThan(order.indexOf('map'));
    expect(order.indexOf('ui')).toBeLessThan(order.indexOf('merge'));
    // face timbre branch: webcam-face → face-features → voice-mapping
    expect(order.indexOf('camFace')).toBeLessThan(order.indexOf('faceFeat'));
    expect(order.indexOf('faceFeat')).toBeLessThan(order.indexOf('map'));
    // face chord branch: webcam-face → face-expression → expression-chord → merge
    expect(order.indexOf('camFace')).toBeLessThan(order.indexOf('faceExpr'));
    expect(order.indexOf('faceExpr')).toBeLessThan(order.indexOf('exprChord'));
    expect(order.indexOf('exprChord')).toBeLessThan(order.indexOf('merge'));
    // head-pose controls branch: webcam-face → face-controls → pose-chord → merge (#76)
    expect(order.indexOf('camFace')).toBeLessThan(order.indexOf('faceCtrl'));
    expect(order.indexOf('faceCtrl')).toBeLessThan(order.indexOf('poseChord'));
    expect(order.indexOf('poseChord')).toBeLessThan(order.indexOf('merge'));
    // both chord instruments feed the overlay highlight via the chord-select join
    expect(order.indexOf('exprChord')).toBeLessThan(order.indexOf('chordSel'));
    expect(order.indexOf('poseChord')).toBeLessThan(order.indexOf('chordSel'));
    expect(order.indexOf('chordSel')).toBeLessThan(order.indexOf('overlay'));
    // Feature Lab (#119): the pure feature-vector taps sit after their sources and
    // before the overlay that draws their meters.
    expect(order.indexOf('camFace')).toBeLessThan(order.indexOf('faceVec'));
    expect(order.indexOf('cam')).toBeLessThan(order.indexOf('handVec'));
    expect(order.indexOf('faceVec')).toBeLessThan(order.indexOf('overlay'));
    expect(order.indexOf('handVec')).toBeLessThan(order.indexOf('overlay'));
    // MIDI output taps the merged voices, so it evaluates after the merge (#13).
    expect(order.indexOf('merge')).toBeLessThan(order.indexOf('midiOut'));
    // Gesture classification taps the hand features, so it evaluates after them (#129).
    expect(order.indexOf('feat')).toBeLessThan(order.indexOf('gesture'));
    // The body branch (#186) sits before the overlay that draws its skeleton, and its
    // feature-vector tap between the two.
    expect(order.indexOf('camBody')).toBeLessThan(order.indexOf('overlay'));
    // Conductor mode (#187): the follower taps the hand frames and the score merges in.
    expect(order.indexOf('cam')).toBeLessThan(order.indexOf('conductor'));
    expect(order.indexOf('conductor')).toBeLessThan(order.indexOf('score'));
    expect(order.indexOf('score')).toBeLessThan(order.indexOf('merge'));
    // Generative layer (#141 / #188): indirect-map taps the hand + face features and
    // feeds the lyria sink; both sit after their sources and after the store node.
    expect(order.indexOf('feat')).toBeLessThan(order.indexOf('imap'));
    expect(order.indexOf('faceFeat')).toBeLessThan(order.indexOf('imap'));
    expect(order.indexOf('ui')).toBeLessThan(order.indexOf('imap'));
    expect(order.indexOf('imap')).toBeLessThan(order.indexOf('gen'));
    // The body vector tap (#186) sits between its source and the overlay.
    expect(order.indexOf('camBody')).toBeLessThan(order.indexOf('bodyVec'));
    expect(order.indexOf('bodyVec')).toBeLessThan(order.indexOf('overlay'));
    // The dance pulse (#186 PR F) sits between the body source and the vector it feeds.
    expect(order.indexOf('camBody')).toBeLessThan(order.indexOf('bodyPulse'));
    expect(order.indexOf('bodyPulse')).toBeLessThan(order.indexOf('bodyVec'));
    // 14 base nodes (#90 retired the kbd + kctrl nodes) + the two #119 feature-vector
    // taps + the #13 midi-out sink + the #129 gesture-classifier tap + the #186 body
    // source, its vector tap and the body-route (#186 PR E) + the #141/#188 generative
    // pair (indirect-map + lyria) + the #187 conductor, score and orchestra + the #249 air bass and
    // its pluck scheduler + the air guitar and its pluck scheduler + the air flute + the chord map and its strum scheduler + the chord wheel.
    expect(order.indexOf('bodyVec')).toBeLessThan(order.indexOf('bodyRoute'));
    expect(order.indexOf('bodyRoute')).toBeLessThan(order.indexOf('map'));
    // Without the air extension: the 29 core nodes (the 10 air nodes come with it); the
    // dance pulse (#186 PR F) is the 27th, the song player (#186 PR G) the 28th, the pace
    // controller (#186 PR H) the 29th. The ASL extension adds its reader and its chord node,
    // the faces extension its personal categorizer (#330 P4).
    expect(order).toHaveLength((AIR ? 39 : 29) + (ASL ? 2 : 0) + (FACES ? 3 : 0));
    // The pace controller (#186 PR H) runs before the song player it feeds: the edges back
    // from the player are delayed, so the loop is not a cycle.
    expect(order.indexOf('bodyPulse')).toBeLessThan(order.indexOf('pace'));
    expect(order.indexOf('pace')).toBeLessThan(order.indexOf('songPlayer'));
  });

  it('wires the body source to the overlay (skeleton + load state) — the #186 reachability guard', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // Without these two edges body tracking would run and show nothing: the toggle
    // would look dead, which is the failure the shipping rule exists to catch.
    expect(has('camBody', 'body', 'overlay', 'bodyFrame')).toBe(true);
    expect(has('camBody', 'status', 'overlay', 'bodyStatus')).toBe(true);
    // The body node is a slot candidate, so it declares NO inputs: its gate is the
    // `body.enabled` dial: since the ADR's PR 3 it decides whether the body branch is
    // composed at all (`branchIdsFor`), not a port.
    expect(edges.filter((e) => e.to.node === 'camBody')).toEqual([]);
  });

  it('wires the generative layer enable/transport/level/steering live from the store — the #141/#188 guard', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // The exact wiring: the steer dials + the transient transport flow from the store
    // into the nodes' live inputs; the features fan out additively (the original
    // feat → map / faceFeat → map edges are untouched).
    expect(has('ui', 'steerEnabled', 'gen', 'enabled')).toBe(true);
    expect(has('ui', 'steerPlaying', 'gen', 'playing')).toBe(true);
    expect(has('ui', 'steerVolume', 'gen', 'volume')).toBe(true);
    expect(has('ui', 'steerConfig', 'imap', 'steerConfig')).toBe(true);
    expect(has('imap', 'steer', 'gen', 'steer')).toBe(true);
    expect(has('feat', 'features', 'imap', 'features')).toBe(true);
    expect(has('faceFeat', 'features', 'imap', 'face')).toBe(true);
    expect(has('feat', 'features', 'map', 'features')).toBe(true);
    // The structural guard (#137's lesson, #141's stated trap): `enabled` left
    // UNCONNECTED means a capability in the bundle with no way to switch it on.
    const inbound = edges.filter((e) => e.to.node === 'gen').map((e) => e.to.port);
    expect(inbound).toContain('enabled');
    expect(inbound).toContain('playing');
    expect(inbound).toContain('steer');
    const imapInbound = edges.filter((e) => e.to.node === 'imap').map((e) => e.to.port);
    expect(imapInbound).toContain('steerConfig');
  });

  it('wires the face overlays (mesh + expression readout + both chord highlights)', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    expect(has('camFace', 'face', 'overlay', 'faceFrame')).toBe(true); // face mesh data
    // The expression readout: the general model's, or (every branch composed) the personal
    // categorizer's, which replaces the general chord (#330 P4) and passes it through.
    expect(has(FACES ? 'faceCat' : 'faceExpr', 'expression', 'overlay', 'expression')).toBe(true);
    // The overlay chord highlight is fed by whichever chord instrument sounds (#76).
    expect(has('exprChord', 'triad', 'chordSel', 'a')).toBe(true);
    expect(has('poseChord', 'chord', 'chordSel', 'b')).toBe(true);
    expect(has('chordSel', 'chord', 'overlay', 'chord')).toBe(true);
    // The overlay reads the MERGED params (hands + both chord instruments) so the
    // keyboard strip's voiced-now cue lights the sounding chord voices, not only the
    // hands (#89). The hand voices stay at indices 0/1, so per-hand labels are intact.
    expect(has('merge', 'params', 'overlay', 'params')).toBe(true);
    expect(has('map', 'params', 'overlay', 'params')).toBe(false);
  });

  it('wires the MIDI output enable/port live from the store — the #137 regression guard', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // The exact wiring: the midi dials flow from the store into the node's live inputs.
    expect(has('ui', 'midiEnabled', 'midiOut', 'enabled')).toBe(true);
    expect(has('ui', 'midiPort', 'midiOut', 'port')).toBe(true);
    // #168 Q3: MIDI reads the merge BEFORE the master mute and takes the mute and the
    // `midi.muteFollowsMaster` dial as its own live inputs. Fed from `merge.params` again,
    // the dial could never keep notes flowing through a mute; with either of the two
    // ports unconnected the dial would be a switch nothing reads (#120 again).
    expect(has('merge', 'unmuted', 'midiOut', 'params')).toBe(true);
    // The PLAYER's mute (not `muteAll`: a tool's claim must not be switchable off by the
    // dial), and the claim on its own port.
    expect(has('ui', 'mute', 'midiOut', 'mute')).toBe(true);
    expect(has('ui', 'claimed', 'midiOut', 'claimed')).toBe(true);
    expect(has('ui', 'muteAll', 'midiOut', 'mute')).toBe(false);
    expect(has('ui', 'midiMuteFollowsMaster', 'midiOut', 'muteFollowsMaster')).toBe(true);
    expect(has('merge', 'params', 'midiOut', 'params')).toBe(false);
    // And the mapping node no longer mutes at the source: the merge is the one place the
    // master mute applies (#91), so the hands' voices still reach MIDI through a mute.
    expect(has('ui', 'mute', 'map', 'mute')).toBe(false);
    // The structural guard #137 asked for: `enabled` left UNCONNECTED means the node
    // can never be turned on from the app — MIDI out shipped exactly that way once
    // (PR #120: complete, tested, unreachable). If this fails, some rewiring dropped
    // the only path a user has to the feature.
    const inbound = edges.filter((e) => e.to.node === 'midiOut').map((e) => e.to.port);
    expect(inbound).toContain('enabled');
    expect(inbound).toContain('port');
    expect(inbound).toContain('params');
    expect(inbound).toContain('mute');
    expect(inbound).toContain('muteFollowsMaster');
    expect(inbound).toContain('claimed');
  });

  it('wires the face CONTROL axis tuning live from the store — the #76 regression guard', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // The exact wiring: the `faceControls` dial flows from the store into the node's
    // live `config` input, so a gain / deadzone / neutral-zero edit lands next tick.
    expect(has('ui', 'faceControls', 'faceCtrl', 'config')).toBe(true);
    // The same structural guard #137 earned, applied to #76's axes. A dial whose port is
    // left unconnected is a dial that silently does nothing — the panel would look alive,
    // every unit test would pass, and turning a knob would change no sound. That is
    // precisely how MIDI out shipped (PR #120) and how the Feature Lab shipped (#119).
    const inbound = edges.filter((e) => e.to.node === 'faceCtrl').map((e) => e.to.port);
    expect(inbound).toContain('face');
    expect(inbound).toContain('config');
  });

  it('wires the Feature Lab vector taps additively off the existing sources (#119)', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // The vectors tap the SAME face/hand frames the rest of the graph reads (fan-out).
    expect(has('camFace', 'face', 'faceVec', 'face')).toBe(true);
    expect(has('cam', 'hands', 'handVec', 'hands')).toBe(true);
    // ...and feed the overlay's featureLab meters.
    expect(has('faceVec', 'vector', 'overlay', 'faceVector')).toBe(true);
    expect(has('handVec', 'vector', 'overlay', 'handVector')).toBe(true);
    // The body tap (#186): same additive shape off the gated body branch.
    expect(has('camBody', 'body', 'bodyVec', 'body')).toBe(true);
    expect(has('bodyVec', 'vector', 'overlay', 'bodyVector')).toBe(true);
    // The original face-mesh + hand-feature edges are untouched (additive).
    expect(has('camFace', 'face', 'overlay', 'faceFrame')).toBe(true);
    expect(has('cam', 'hands', 'feat', 'hands')).toBe(true);
  });

  it('the trainer tap names edges that ACTUALLY EXIST (#160)', () => {
    // The trainer observes the live feature vector through a DAG tap keyed by
    // `"<node>.<port>"` strings. A tap listening to a key nothing emits is silent, not
    // broken — the panel would just capture nothing and the coverage meter would sit at
    // zero, with every unit test still green. That is #137's failure shape, so the edge
    // names are asserted structurally here rather than trusted.
    const g = defaultGraph();
    for (const key of FEATURE_VECTOR_EDGES) {
      const [nodeId, port] = key.split('.');
      const node = g.nodes.find((n) => n.id === nodeId);
      expect(node, `tap edge "${key}" names a node that is not in the graph`).toBeTruthy();
      const emits = g.edges.some((e) => e.from.node === nodeId && e.from.port === port);
      expect(emits, `tap edge "${key}" names a port nothing emits`).toBe(true);
    }
  });

  it('wires the gesture classifier additively off the hand features (#129)', () => {
    const g = defaultGraph();
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      g.edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // The classifier taps the SAME hand-features stream the mapping/overlay read.
    const gesture = g.nodes.find((n) => n.id === 'gesture');
    expect(gesture?.type).toBe('gesture-classifier');
    expect(has('feat', 'features', 'gesture', 'features')).toBe(true);
    // The original hand-features edges are untouched (additive fan-out).
    expect(has('feat', 'features', 'map', 'features')).toBe(true);
    expect(has('feat', 'features', 'overlay', 'features')).toBe(true);
    // Its output is deliberately consumed APP-side (useEngine reads `poses` off the
    // engine each frame and feeds the gesture dispatcher) — the #137-style guard
    // that the mounted node is actually read lives in test/gesture_dispatch.test.ts.
  });

  it('wires the conductor live from the store and the score behind it — the #187 guard', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // The dial reaches the node as a LIVE input (the #147 template): `config` left
    // unconnected would mean conducting can never be turned on from the app.
    expect(has('ui', 'conductor', 'conductor', 'config')).toBe(true);
    expect(has('cam', 'hands', 'conductor', 'hands')).toBe(true);
    // The score reads ONE beat from ONE node, plus the dynamics and the enable gate.
    expect(has('conductor', 'beat', 'score', 'beat')).toBe(true);
    expect(has('conductor', 'velocityScale', 'score', 'velocityScale')).toBe(true);
    // The enable gate is `leadsScore` (#187 PR 7): silent while the conductor leads a recording.
    expect(has('conductor', 'leadsScore', 'score', 'enabled')).toBe(true);
    expect(edges.filter((e) => e.to.node === 'score' && e.to.port === 'beat')).toHaveLength(1);
    // The conducted score joins the other producers at the merge (mute + taps cover it).
    expect(has('score', 'params', 'merge', 'score1')).toBe(true);
  });

  it('wires the orchestra live from the dial and the conductor, and hands it the piece — the #187 PR 5 guard', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // The #147 template: the enable lives in the conductor dial's `orchestra` field, so
    // `config` left unconnected would make the orchestra impossible to switch on.
    expect(has('ui', 'conductor', 'orchestra', 'config')).toBe(true);
    expect(has('conductor', 'time', 'orchestra', 'time')).toBe(true);
    expect(has('conductor', 'leadsScore', 'orchestra', 'conducting')).toBe(true);
    expect(has('conductor', 'velocityScale', 'orchestra', 'velocityScale')).toBe(true);
    expect(has('ui', 'scoreDoc', 'orchestra', 'doc')).toBe(true);
    expect(has('ui', 'claimed', 'orchestra', 'claimed')).toBe(true);
    // The handover: without it the oscillators and the orchestra would play the piece twice.
    expect(has('orchestra', 'playing', 'score', 'replaced')).toBe(true);
    // The loaded piece reaches the score live from the store (PR 3): a ScoreDoc that
    // could be loaded but never played is the #120 failure mode again.
    expect(has('ui', 'scoreDoc', 'score', 'doc')).toBe(true);
    // PR 4: the piece's meter and fermatas reach the conductor; the conductor's musical
    // time and enable flag reach the overlay's beat HUD (a HUD nothing feeds draws nothing).
    expect(has('ui', 'scoreDoc', 'conductor', 'doc')).toBe(true);
    expect(has('conductor', 'time', 'overlay', 'conductorTime')).toBe(true);
    expect(has('conductor', 'enabled', 'overlay', 'conductorEnabled')).toBe(true);
    const inbound = edges.filter((e) => e.to.node === 'conductor').map((e) => e.to.port);
    expect(inbound).toContain('config');
    expect(inbound).toContain('hands');
  });

  it('routes the mute to the merge so it silences the chords too (#91)', () => {
    const edges = defaultGraph().edges;
    const has = (fn: string, fp: string, tn: string, tp: string) =>
      edges.some((e) => e.from.node === fn && e.from.port === fp && e.to.node === tn && e.to.port === tp);
    // The master mute reaches the single convergence point (synth-merge), so the
    // face-chord instruments (which merge in after voice-mapping) are muted along
    // with the hand voices — the fix for #91. Since #90 the mute is a store flag
    // sourced from `ui` (store-controls), not the retired `keyboard-control` node.
    // Round 4: the merge reads `muteAll` = the player's mute OR a tool's hush claim
    // (`hushOf`, whose tests pin that `muted` alone raises it), so M still reaches it.
    expect(has('ui', 'muteAll', 'merge', 'mute')).toBe(true);
    // The original hand-stage mute edge is GONE (#168 Q3): it was belt-and-suspenders
    // for the synth, but it silenced the hands' voices before MIDI out could read them,
    // and the `midi.muteFollowsMaster` dial needs them flowing through a mute. The merge
    // alone mutes the synth: `muteAll` covers the player's M (`hushOf` pins that).
    expect(has('ui', 'mute', 'map', 'mute')).toBe(false);
  });

  it('ticks cleanly with no host resources (everything no-ops or idles)', () => {
    const recorder = new StreamRecorder();
    // No resources: webcam has no video (emits empty frame), synth has no
    // AudioContext (no-op), overlay has no canvas (no-op), store-controls has
    // no getter. The graph must still run and produce silent synth params.
    const engine = new Engine(defaultGraph(), createAppRegistry(), { taps: [recorder] });
    expect(() => {
      engine.tick();
      engine.tick();
    }).not.toThrow();

    const params = recorder.values('map.params') as SynthParams[];
    expect(params.length).toBe(2);
    // No hands present → both voices silent.
    expect(params[0].voices.every((v) => !v.present)).toBe(true);
    expect(params[0].voices).toHaveLength(2);

    // The synth's actual input is the merge of hand voices (0,1) + the 4 stable
    // emotion-chord voices (2..5) + the 5 stable pose-chord voices (6..10) — all
    // distinct ids, all silent while both face chord sources are idle (#76). The score
    // (#187) emits voices only while its notes sound (ids from 11), and conducting is
    // off here, so it contributes none. The air flute (#249) always carries its one
    // voice, absent while it is off (so a flute switched off mid-note fades).
    const merged = recorder.values('merge.params') as SynthParams[];
    const ids = merged[0].voices.map((v) => v.id);
    const core = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // The ASL chords (ids from 2e6) and the categorizer chords (#450, from 3e6) always carry
    // their four voices, silent here.
    const catChord = FACES ? [3_000_000, 3_000_001, 3_000_002, 3_000_003] : [];
    // The chord map (air) carries its five chord voices and its melody voice, silent here.
    const chordMap = [0, 1, 2, 3, 4].map((i) => CHORD_MAP_VOICE_ID_BASE + i).concat(CHORD_MAP_MELODY_VOICE_ID);
    // The chord wheel (air) its five chord voices.
    const chordWheel = [0, 1, 2, 3, 4].map((i) => CHORD_WHEEL_VOICE_ID_BASE + i);
    const merged0 = [...core, ...(AIR ? [FLUTE_VOICE_ID, ...chordMap, ...chordWheel] : []), ...(ASL ? [2_000_000, 2_000_001, 2_000_002, 2_000_003] : []), ...catChord];
    expect([...ids].sort((a, b) => a - b)).toEqual(merged0.sort((a, b) => a - b));
    expect(ids.slice(0, 2)).toEqual([0, 1]); // the hand voices lead (the overlay reads them by position)
    expect(new Set(ids).size).toBe(ids.length); // no id collision across hands + both chords + flute
    expect(merged[0].voices.every((v) => !v.present)).toBe(true);
  });
});
