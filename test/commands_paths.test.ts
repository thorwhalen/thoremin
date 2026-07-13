/**
 * Path-addressed writes into the STRUCTURED dials (#126) — the piece that finally makes
 * the registry the single write path for the WHOLE panel, not just its scalar half.
 *
 * Two things are under test:
 *  - `src/app/commands/paths.ts` — the leaf keyspace DERIVED from the dials SSOT (schema +
 *    declared defaults), the longest-prefix path→dial resolution (dial keys are themselves
 *    dotted, so a naive first-dot split is wrong), and the immutable deep-set.
 *  - the `dial.setIn` command built on it — same write contract as `dial.set`
 *    (unknown-key guard, value validated against the full settings schema before it lands),
 *    with `unknown_path` added.
 *
 * Pure + headless: no camera, audio, or React.
 */
import { describe, it, expect } from 'vitest';
import { isErr } from 'acture';
import {
  createThoreminRegistry,
  applyDialSetIn,
  structuredLeafPaths,
  structuredDialLeaves,
  resolveDialPath,
  leafByPath,
  setIn,
} from '@/app/commands';
import { dialsStore } from '@/app/dials/settingsStore';
import { useControls } from '@/app/store';
import { thoreminDials } from '@/settings/dials';
import { EXPRESSIONS, EMOTIONS } from '@/music/expression';
import { FINGER_NAMES } from '@/nodes/domain';

/** Read a dotted path out of a plain object (the read-side mirror of `setIn`). */
function getIn(obj: unknown, rest: readonly string[]): unknown {
  return rest.reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], obj);
}

describe('structured-dial leaf paths (#126)', () => {
  const paths = structuredLeafPaths();

  it('derives a leaf path for every scalar inside every structured dial', () => {
    // One representative per structured dial + per nesting shape: a plain nested object
    // (overlay), a nested object inside a nested object (the finger routes), and a RECORD
    // whose members come from the shipped default (the expression maps).
    for (const p of [
      'overlay.landmarks.show',
      'overlay.video.alpha',
      'overlay.chordName.position',
      'overlay.keyboardStrip.height',
      'handMap.positionSource',
      'handMap.panSpread',
      'handMap.fingers.index.target',
      'handMap.fingers.pinky.invert',
      'faceExpr.degrees.happy',
      'faceExpr.sensitivity.happy',
    ]) {
      expect(paths, `"${p}" must be an addressable dial leaf`).toContain(p);
    }
  });

  it('yields ONLY scalars — no object path leaks in', () => {
    // The invariant the whole design rests on: a command's value must stay scalar (an
    // object param emits a JSON Schema Gemini's validator rejects). Checked against the
    // LIVE dial values, not the schema, so a walk that stopped one level short is caught.
    const effective = dialsStore.getState().effective;
    for (const leaf of structuredDialLeaves()) {
      const value = getIn(effective[leaf.key], leaf.rest);
      expect(['string', 'number', 'boolean'], `${leaf.path} resolves to a ${typeof value}`).toContain(typeof value);
    }
    // ...and the container paths themselves are explicitly NOT offered.
    for (const p of ['overlay', 'overlay.video', 'handMap', 'handMap.fingers', 'handMap.fingers.index', 'faceExpr.degrees']) {
      expect(paths, `"${p}" is an object, not a settable leaf`).not.toContain(p);
    }
  });

  it('excludes the SCALAR dials — those are `dial.set`\'s job, not a path\'s', () => {
    for (const key of ['right.sound', 'master.volume', 'face.mapping', 'faceChord.bpm']) {
      expect(paths).not.toContain(key);
    }
  });

  it('a RECORD dial takes its key set from the shipped DEFAULT (the SSOT for which members exist)', () => {
    // `z.record` declares no keys, so the default value is the only honest source for
    // "which expressions exist". Every expression the panel renders must be addressable.
    for (const e of EXPRESSIONS) expect(paths).toContain(`faceExpr.degrees.${e}`);
    for (const e of EMOTIONS) expect(paths).toContain(`faceExpr.sensitivity.${e}`);
    // Same idea one level down: every finger the panel renders gets its four route fields.
    for (const f of FINGER_NAMES) {
      for (const field of ['target', 'sensitivity', 'mode', 'invert']) {
        expect(paths).toContain(`handMap.fingers.${f}.${field}`);
      }
    }
  });

  it('reads each leaf\'s KIND from the schema (so a string arg is coerced correctly)', () => {
    expect(leafByPath['overlay.video.alpha'].kind).toBe('number');
    expect(leafByPath['overlay.landmarks.show'].kind).toBe('boolean');
    expect(leafByPath['overlay.chordName.position'].kind).toBe('enum');
    expect(leafByPath['handMap.fingers.index.target'].kind).toBe('enum');
    expect(leafByPath['handMap.fingers.index.invert'].kind).toBe('boolean');
    expect(leafByPath['faceExpr.degrees.happy'].kind).toBe('number');
  });

  it('is sorted, unique, and covers every structured dial', () => {
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
    expect(new Set(paths).size).toBe(paths.length);
    const owners = new Set(structuredDialLeaves().map((l) => l.key));
    expect(owners).toEqual(new Set(['overlay', 'handMap', 'faceExpr.degrees', 'faceExpr.sensitivity']));
    // Every declared structured dial has at least one settable leaf — otherwise it would
    // be silently unreachable by BOTH `dial.set` (skipped: not a scalar) and `dial.setIn`.
    expect(owners.size).toBeGreaterThan(0);
    expect(paths.length).toBeGreaterThan(50); // the overlay alone contributes 30-plus
  });
});

describe('resolveDialPath — LONGEST-prefix, because dial keys are themselves dotted (#126)', () => {
  it('resolves faceExpr.degrees.happy to the DOTTED dial key, never to a phantom `faceExpr`', () => {
    expect(resolveDialPath('faceExpr.degrees.happy')).toEqual({ key: 'faceExpr.degrees', rest: ['happy'] });
    // The bug a first-dot split would produce: `faceExpr` is not a dial at all.
    expect(thoreminDials.keys).not.toContain('faceExpr');
    expect(resolveDialPath('faceExpr')).toBeNull();
  });

  it('resolves a single-segment dial key with the rest of the path inside it', () => {
    expect(resolveDialPath('overlay.video.alpha')).toEqual({ key: 'overlay', rest: ['video', 'alpha'] });
    expect(resolveDialPath('handMap.fingers.index.target')).toEqual({
      key: 'handMap',
      rest: ['fingers', 'index', 'target'],
    });
  });

  it('resolves a SCALAR dial addressed by its own key with an empty rest', () => {
    expect(resolveDialPath('right.sound')).toEqual({ key: 'right.sound', rest: [] });
  });

  it('returns null for a path under no declared dial', () => {
    expect(resolveDialPath('nope.nope')).toBeNull();
    expect(resolveDialPath('right')).toBeNull(); // `right` is a namespace, not a dial
  });

  it('the keyspace is PREFIX-FREE — the property that makes any resolution order agree today', () => {
    // Longest-prefix is the correct rule in general, and the ONLY thing that saves
    // `faceExpr.degrees.happy` from resolving to a phantom `faceExpr` dial. But be honest
    // about what is actually load-bearing right now: no declared dial key is a proper
    // prefix of another, so longest- and shortest-MATCHING-prefix cannot currently be told
    // apart (only a first-dot split, which skips the membership check entirely, breaks).
    //
    // This assertion is the tripwire: the day someone declares both `foo` and `foo.bar` as
    // dials, resolution order starts to MATTER and this test fails, forcing the question.
    const keys = [...thoreminDials.keys].sort();
    const offenders = keys.flatMap((a) => keys.filter((b) => b !== a && b.startsWith(`${a}.`)).map((b) => `${a} < ${b}`));
    expect(
      offenders,
      'A dial key is now a proper prefix of another. Longest-prefix resolution is still ' +
        'correct, but the choice is no longer free — re-read resolveDialPath and this test.',
    ).toEqual([]);
  });
});

describe('setIn — immutable deep-set (#126)', () => {
  it('replaces the leaf and NEVER mutates the input', () => {
    const before = Object.freeze({ video: Object.freeze({ show: true, alpha: 0.35 }), landmarks: { show: true } });
    // A frozen input makes the claim testable rather than merely asserted: a mutating
    // implementation throws here in strict mode instead of quietly passing.
    const after = setIn(before, ['video', 'alpha'], 0.8);
    expect(after).toEqual({ video: { show: true, alpha: 0.8 }, landmarks: { show: true } });
    expect(before.video.alpha).toBe(0.35); // the input is untouched
    expect(after).not.toBe(before);
    expect(after.video).not.toBe(before.video);
  });

  it('shares the untouched branches (structural sharing)', () => {
    const before = { video: { show: true }, landmarks: { show: true } };
    const after = setIn(before, ['video', 'show'], false);
    expect(after.landmarks).toBe(before.landmarks); // untouched branch reused by reference
  });

  it('with an empty path, the value REPLACES the object', () => {
    expect(setIn({ a: 1 }, [], 7)).toBe(7);
  });
});

describe('dial.setIn — the structured-dial write command (#126)', () => {
  const registry = createThoreminRegistry();

  it('is registered, alongside the other generic dial verbs', () => {
    expect(registry.has('dial.setIn')).toBe(true);
  });

  it('a nested overlay write lands in the dials store AND the hot mirror', async () => {
    const r = await registry.dispatch('dial.setIn', { path: 'overlay.landmarks.show', value: false });
    expect(r.ok).toBe(true);
    expect((dialsStore.getState().effective['overlay'] as { landmarks: { show: boolean } }).landmarks.show).toBe(false);
    expect(useControls.getState().overlay.landmarks.show).toBe(false); // the DAG reads THIS
  });

  it('a nested ENUM write (a finger route) lands in the hot mirror', async () => {
    const r = await registry.dispatch('dial.setIn', { path: 'handMap.fingers.index.target', value: 'vibrato' });
    expect(r.ok).toBe(true);
    expect(useControls.getState().handMap.fingers.index.target).toBe('vibrato');
  });

  it('a RECORD-member write (an expression degree) lands in the hot mirror', async () => {
    const r = await registry.dispatch('dial.setIn', { path: 'faceExpr.degrees.happy', value: 4 });
    expect(r.ok).toBe(true);
    expect(useControls.getState().faceExpr.degrees.happy).toBe(4);
  });

  it('leaves the SIBLING leaves of the dial alone (a deep-set, not a replace)', async () => {
    const before = useControls.getState().handMap;
    await registry.dispatch('dial.setIn', { path: 'handMap.fingers.middle.invert', value: true });
    const after = useControls.getState().handMap;
    expect(after.fingers.middle.invert).toBe(true);
    expect(after.fingers.index.target).toBe(before.fingers.index.target);
    expect(after.positionSource).toBe(before.positionSource);
    expect(after.maxGain).toBe(before.maxGain);
  });

  it('an unknown path is DATA (`unknown_path`), never a throw — and never a junk write', () => {
    // `overlay.bogus` RESOLVES to the overlay dial, so without the declared-leaf check the
    // deep-set would create a junk key, Zod would strip it on parse, the write would still
    // succeed, and the dials layer would carry silent garbage. It must be refused.
    const junk = applyDialSetIn('overlay.bogus.show', true);
    expect(isErr(junk)).toBe(true);
    if (isErr(junk)) expect(junk.error.code).toBe('unknown_path');
    expect(dialsStore.getState().effective['overlay']).not.toHaveProperty('bogus');

    // ...and a path under no dial at all.
    const nowhere = applyDialSetIn('nope.nope.nope', 1);
    expect(isErr(nowhere)).toBe(true);
    if (isErr(nowhere)) expect(nowhere.error.code).toBe('unknown_path');

    // ...and a SCALAR dial, which has no leaf to set into (it has `dial.set`).
    const scalar = applyDialSetIn('right.sound', 'square');
    expect(isErr(scalar)).toBe(true);
    if (isErr(scalar)) expect(scalar.error.code).toBe('unknown_path');
  });

  it('an out-of-range value → `invalid_value`, and the dial is UNCHANGED', () => {
    const before = useControls.getState().overlay.video.alpha;
    const r = applyDialSetIn('overlay.video.alpha', 5); // bounded 0..1
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('invalid_value');
    expect((dialsStore.getState().effective['overlay'] as { video: { alpha: number } }).video.alpha).toBe(before);
    expect(useControls.getState().overlay.video.alpha).toBe(before); // audio never diverged
  });

  it('an ENUM leaf refuses a bad member, and the route is UNCHANGED', () => {
    const before = useControls.getState().handMap.fingers.ring.target;
    const r = applyDialSetIn('handMap.fingers.ring.target', 'not-an-effect');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('invalid_value');
    expect(useControls.getState().handMap.fingers.ring.target).toBe(before);
  });

  it('an out-of-range RECORD member is refused too (the degree bounds are real)', () => {
    const before = useControls.getState().faceExpr.degrees.sad;
    const r = applyDialSetIn('faceExpr.degrees.sad', 99); // -1..6
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('invalid_value');
    expect(useControls.getState().faceExpr.degrees.sad).toBe(before);
  });

  it('the param layer refuses a path outside the derived enum (invalid_params)', async () => {
    // The path enum is the discoverable keyspace AND a typo guard: a bad path never even
    // reaches the handler.
    const r = await registry.dispatch('dial.setIn', { path: 'overlay.nope.show', value: true });
    expect(r.ok).toBe(false);
    if (isErr(r)) expect(r.error.code).toBe('invalid_params');
  });

  it('coerces a STRING arg to the leaf\'s declared type (the shape an AI model sends)', async () => {
    const num = await registry.dispatch('dial.setIn', { path: 'overlay.video.alpha', value: '0.75' });
    expect(num.ok).toBe(true);
    expect(useControls.getState().overlay.video.alpha).toBe(0.75); // a number, not "0.75"

    const bool = await registry.dispatch('dial.setIn', { path: 'overlay.markers.showNotes', value: 'false' });
    expect(bool.ok).toBe(true);
    expect(useControls.getState().overlay.markers.showNotes).toBe(false); // a boolean, not "false"
  });
});
