/**
 * Cues and routines (#163): the schema that says what a cue IS, the starter set the
 * trainer ships with, and the two zodal collections they persist in.
 *
 * Three things are guarded here that a green runner test would never notice:
 *
 * - **The wording rules on the starter set.** The whole trainer exists because the
 *   expressions a population model prescribes are the ones a given player cannot hit
 *   (identity bias — `docs/research/trainer-mode.md`). A starter cue that said "smile"
 *   would quietly reintroduce the failure mode, so the text itself is under test.
 * - **The schema's cross-field rules.** `produces` decides how a cue samples (every
 *   frame vs held still-points), and a sufficiency of the wrong kind would make the
 *   runner wait for something that never arrives. The refinements are what stop a
 *   hand-authored (or agent-authored) cue from being saved in that state.
 * - **Starters merged with stored, by id.** A starter lives in code, not in a seed row,
 *   so improving its wording never fights a stale copy in localStorage — and a player
 *   overrides one by saving a cue under its name. The merge has to keep the starter's
 *   POSITION, or the routine order silently changes.
 *
 * The stores run over an in-memory `DataProvider` (the same facade that defaults to
 * localStorage in the browser), so this needs no DOM and proves the backend swaps.
 */
import { describe, it, expect } from 'vitest';
import { slugId } from '@/util/ids';
import { createInMemoryProvider } from '@zodal/store';
import {
  CueRecordSchema,
  CueSchema,
  CueSpecSchema,
  RoutineRecordSchema,
  SufficiencySchema,
  cueFeatures,
  cueFromRecord,
  resolveRoutine,
  routineFeatures,
  routineGroups,
  samplingFor,
  type Cue,
  type CueRecord,
  type CueSpec,
  type CueSpecInput,
  type RoutineRecord,
  RoutineSpecSchema,
} from '@/enroll';
import { DEFAULT_ROUTINE_CUE_IDS, FACE_OMIT, FACE_TRAINING_GROUPS, STARTER_CUES } from '@/app/enroll/starterCues';
import {
  CUES_STORAGE_KEY,
  ROUTINES_STORAGE_KEY,
  createCueStore,
  createRoutineStore,
  cueTags,
  filterCues,
  listCues,
  loadRoutine,
  loadStoredCues,
  mergeCues,
} from '@/app/enroll/cueStore';
import { FEATURE_BY_ID, FEATURE_GROUPS } from '@/features/catalog';

// ---- Fixtures ----------------------------------------------------------------

/** The loosest valid authoring input: a movement cue with every optional field left out. */
const specInput = (overrides: Partial<CueSpecInput> = {}): CueSpecInput => ({
  instruction: 'Turn your head to look to your left, and hold it.',
  collects: { groups: ['face.head'] },
  produces: 'vocabulary',
  sufficiency: { kind: 'excursion' },
  ...overrides,
});

/** The same, parsed — what a store's `save` takes (defaults already applied). */
const parsedSpec = (overrides: Partial<CueSpecInput> = {}): CueSpec => CueSpecSchema.parse(specInput(overrides));

/** A runner-shaped cue for the pure helpers (no persistence involved). */
const cue = (id: string, groups: string[], omit: string[] = []): Cue =>
  CueSchema.parse({ id, name: id, ...specInput({ collects: { groups, omit } }) });

const cueStore = () => createCueStore(createInMemoryProvider<CueRecord>([], { searchFields: ['name'] }));
const routineStore = () => createRoutineStore(createInMemoryProvider<RoutineRecord>([], { searchFields: ['name'] }));

/** The issue paths a failed parse reports, joined — so a test can name WHICH rule fired. */
function issuePaths(schema: { safeParse(v: unknown): unknown }, value: unknown): string[] {
  const r = schema.safeParse(value) as { success: boolean; error?: { issues: { path: PropertyKey[] }[] } };
  if (r.success) return [];
  return (r.error?.issues ?? []).map((i) => i.path.map(String).join('.'));
}

// ---- 1. Schema ----------------------------------------------------------------

describe('cue schema — what a cue IS (the zodal SSOT)', () => {
  it('accepts every starter cue whole: id, name, instruction and a non-empty attention set', () => {
    expect(STARTER_CUES.length).toBeGreaterThan(0);
    for (const c of STARTER_CUES) {
      expect(CueSchema.safeParse(c).success).toBe(true);
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.instruction).toBeTruthy();
      expect(c.collects.groups.length).toBeGreaterThan(0);
    }
  });

  it('fills every optional field with a default, so a cue saved by an older build still parses after fields are added', () => {
    const c = CueSpecSchema.parse(specInput());
    expect(c.variations).toEqual([]);
    expect(c.tags).toEqual([]);
    expect(c.collects.omit).toEqual([]);
    expect(c.collects.axes).toEqual([]);
    expect(c.rationale).toBe('');
  });

  it('applies the per-kind sufficiency defaults (noise units — the same number means the same thing for an angle and a blendshape)', () => {
    expect(SufficiencySchema.parse({ kind: 'frames' })).toEqual({ kind: 'frames', minFrames: 90, patienceMs: 20000 });
    expect(SufficiencySchema.parse({ kind: 'excursion' })).toEqual({
      kind: 'excursion',
      minPoints: 1,
      minExcursion: 8,
      patienceMs: 20000,
    });
    expect(SufficiencySchema.parse({ kind: 'variety' })).toEqual({
      kind: 'variety',
      minPoints: 6,
      minSeparation: 6,
      holdNudgeMs: 8000,
      patienceMs: 60000,
    });
  });

  it('rejects a nuisance cue that names no axes — there would be nothing to down-weight', () => {
    const bad = specInput({ produces: 'nuisance', sufficiency: { kind: 'frames' } });
    expect(issuePaths(CueSpecSchema, bad)).toContain('collects.axes');
    const good = { ...bad, collects: { groups: ['face.head'], axes: ['scale' as const] } };
    expect(CueSpecSchema.safeParse(good).success).toBe(true);
  });

  it('rejects a baseline or nuisance cue whose sufficiency is not frame-counting — they sample every frame', () => {
    const baseline = specInput({ produces: 'baseline', sufficiency: { kind: 'excursion' } });
    expect(issuePaths(CueSpecSchema, baseline)).toContain('sufficiency');
    const nuisance = specInput({
      produces: 'nuisance',
      collects: { groups: ['face.head'], axes: ['scale'] },
      sufficiency: { kind: 'variety' },
    });
    expect(issuePaths(CueSpecSchema, nuisance)).toContain('sufficiency');
  });

  it('rejects a vocabulary cue with a frames sufficiency — it collects still-points, and a frame count never says "enough" of those', () => {
    const bad = specInput({ produces: 'vocabulary', sufficiency: { kind: 'frames' } });
    expect(issuePaths(CueSpecSchema, bad)).toContain('sufficiency');
    expect(CueSpecSchema.safeParse(specInput({ sufficiency: { kind: 'variety' } })).success).toBe(true);
  });

  it('requires at least one group — a cue with no attention set has nothing to judge "held" on', () => {
    expect(issuePaths(CueSpecSchema, specInput({ collects: { groups: [] } }))).toContain('collects.groups');
  });

  it('the record schemas wrap the spec under the payload key the collections use', () => {
    const rec = CueRecordSchema.parse({ id: 'x', name: 'X', createdAt: 1, cue: specInput() });
    expect(rec.cue.variations).toEqual([]);
    const routine = RoutineRecordSchema.parse({ id: 'r', name: 'R', createdAt: 1, routine: { cueIds: ['rest'] } });
    expect(routine.routine.cueIds).toEqual(['rest']);
    expect(RoutineRecordSchema.safeParse({ id: 'r', name: 'R', createdAt: 1, routine: { cueIds: [] } }).success).toBe(false);
  });
});

// ---- 2. Wording rules ---------------------------------------------------------

describe('starter cues — the wording rules', () => {
  /** Anything a population model would prescribe. Word-bounded so "sad" cannot hide in "said". */
  const PRESCRIBED = /\b(happy|sad|angry|surprised|disgusted|fearful|smile|frown)\b/i;

  it('never names an expression to imitate — prescribed expressions are the failure mode this feature exists to escape', () => {
    for (const c of STARTER_CUES) {
      for (const text of [c.name, c.instruction, ...c.variations]) {
        expect(text, `cue ${c.id}: "${text}"`).not.toMatch(PRESCRIBED);
      }
    }
  });

  it('keeps every instruction short and sentence-final — it is spoken as well as shown', () => {
    for (const c of STARTER_CUES) {
      expect(c.instruction.length, `cue ${c.id}`).toBeLessThan(160);
      expect(c.instruction, `cue ${c.id}`).toMatch(/\.$/);
      for (const v of c.variations) expect(v, `cue ${c.id} variation`).toMatch(/\.$/);
    }
  });

  it('gives every cue a rationale, so the ritual never feels arbitrary', () => {
    for (const c of STARTER_CUES) expect(c.rationale.trim(), `cue ${c.id}`).not.toBe('');
  });

  it('opens with rest (the baseline) and closes with the free vocabulary — the part that is actually the player\'s', () => {
    const first = STARTER_CUES[0];
    const last = STARTER_CUES[STARTER_CUES.length - 1];
    expect(first.id).toBe('rest');
    expect(first.produces).toBe('baseline');
    expect(last.produces).toBe('vocabulary');
    expect(last.sufficiency.kind).toBe('variety');
  });

  it('demonstrates exactly one nuisance — camera distance — declared as the scale axis', () => {
    const nuisance = STARTER_CUES.filter((c) => c.produces === 'nuisance');
    expect(nuisance).toHaveLength(1);
    expect(nuisance[0].collects.axes).toEqual(['scale']);
  });

  it('uses distinct ids, and the default routine is exactly those ids in order (the merge and the routine are both by id)', () => {
    const ids = STARTER_CUES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_ROUTINE_CUE_IDS).toEqual(ids);
  });
});

// ---- 3. Starter groups --------------------------------------------------------

describe('starter groups — what a face take records', () => {
  const faceGroupIds = new Set(FEATURE_GROUPS.filter((g) => g.source === 'face').map((g) => g.id));
  const allGroupIds = new Set(FEATURE_GROUPS.map((g) => g.id));

  it('FACE_TRAINING_GROUPS holds only face.* catalog groups, and leaves out both gaze families and derived', () => {
    expect(FACE_TRAINING_GROUPS.length).toBeGreaterThan(0);
    for (const g of FACE_TRAINING_GROUPS) {
      expect(g, g).toMatch(/^face\./);
      expect(faceGroupIds.has(g), g).toBe(true);
    }
    expect(FACE_TRAINING_GROUPS).not.toContain('face.gaze');
    expect(FACE_TRAINING_GROUPS).not.toContain('face.blendshape.gaze');
    expect(FACE_TRAINING_GROUPS).not.toContain('derived');
    expect(FACE_TRAINING_GROUPS).toContain('face.head');
  });

  it('every group a starter cue collects exists in the catalog — a claim the catalog cannot resolve records nothing', () => {
    for (const c of STARTER_CUES) for (const g of c.collects.groups) expect(allGroupIds.has(g), `cue ${c.id}: ${g}`).toBe(true);
  });

  it('FACE_OMIT names real features, all in face.head (where you sit, not what you do)', () => {
    expect(FACE_OMIT.length).toBeGreaterThan(0);
    for (const id of FACE_OMIT) {
      expect(FEATURE_BY_ID[id], id).toBeDefined();
      expect(FEATURE_BY_ID[id].group, id).toBe('face.head');
    }
  });

  it('every starter cue omits the frame-position features, so shifting in the chair between cues is not an expression', () => {
    for (const c of STARTER_CUES) expect(c.collects.omit, `cue ${c.id}`).toEqual([...FACE_OMIT]);
  });
});

// ---- 4. Helpers ---------------------------------------------------------------

describe('the override-by-name contract', () => {
  it('every starter id is exactly slugId(name) — saving a cue under a starter\'s NAME replaces it', () => {
    // cueStore's merge is by id and the store derives ids from names, so this equality
    // is what makes "customise a starter by saving under its name" true.
    for (const c of STARTER_CUES) expect(slugId(c.name, 'cue')).toBe(c.id);
  });

  it('a routine lists each cue at most once (a second run would replace the first\'s take)', () => {
    expect(RoutineSpecSchema.safeParse({ cueIds: ['rest', 'look-left', 'rest'] }).success).toBe(false);
    // resolveRoutine tolerates a duplicate from an older record: it runs the first.
    const r = resolveRoutine(['rest', 'look-left', 'rest'], STARTER_CUES);
    expect(r.cues.map((c) => c.id)).toEqual(['rest', 'look-left']);
  });
});

describe('cue helpers — modality-neutral, over a toy registry', () => {
  const TOY_IDS = ['a', 'b', 'c'] as const;
  const TOY_GROUP: Record<string, string> = { a: 'g1', b: 'g1', c: 'g2' };
  const groupOf = (id: string): string | undefined => TOY_GROUP[id];

  it('samplingFor: baseline and nuisance sample every frame; vocabulary samples held still-points', () => {
    expect(samplingFor({ produces: 'baseline' })).toBe('continuous');
    expect(samplingFor({ produces: 'nuisance' })).toBe('continuous');
    expect(samplingFor({ produces: 'vocabulary' })).toBe('still-points');
  });

  it('cueFeatures resolves groups to ids and applies omit — the cue never names a feature id itself', () => {
    expect(cueFeatures(cue('x', ['g1'], ['b']), TOY_IDS, groupOf)).toEqual(['a']);
    expect(cueFeatures(cue('x', ['g1']), TOY_IDS, groupOf)).toEqual(['a', 'b']);
    expect(cueFeatures(cue('x', ['g9']), TOY_IDS, groupOf)).toEqual([]);
    // An id the registry does not know has no group and never matches.
    expect(cueFeatures(cue('x', ['g1']), ['a', 'zzz'], groupOf)).toEqual(['a']);
  });

  it('routineFeatures is the union over cues, in REGISTRY order (stable across routines, not insertion order)', () => {
    const cues = [cue('second-group-first', ['g2']), cue('then-first', ['g1'], ['b'])];
    expect(routineFeatures(cues, TOY_IDS, groupOf)).toEqual(['a', 'c']);
    expect(routineFeatures([], TOY_IDS, groupOf)).toEqual([]);
  });

  it('routineGroups dedupes group ids in first-seen order', () => {
    const cues = [cue('x', ['g2', 'g1']), cue('y', ['g1', 'g3'])];
    expect(routineGroups(cues)).toEqual(['g2', 'g1', 'g3']);
  });

  it('resolveRoutine keeps the routine order and REPORTS unknown ids instead of throwing — run the rest, say what was skipped', () => {
    const { cues, missing } = resolveRoutine(['your-faces', 'nope', 'rest'], STARTER_CUES);
    expect(cues.map((c) => c.id)).toEqual(['your-faces', 'rest']);
    expect(missing).toEqual(['nope']);
  });

  it('cueFromRecord flattens {id, name, createdAt, cue} into the runner shape, dropping the persistence metadata', () => {
    const spec = parsedSpec();
    const flat = cueFromRecord({ id: 'x', name: 'X', createdAt: 42, cue: spec });
    expect(flat).toEqual({ id: 'x', name: 'X', ...spec });
    expect('createdAt' in flat).toBe(false);
  });
});

// ---- 5. Stores ----------------------------------------------------------------

describe('cue and routine stores — the two zodal collections, over an in-memory provider', () => {
  it('keep distinct storage keys (sharing one would merge the collections)', () => {
    expect(CUES_STORAGE_KEY).toBeTruthy();
    expect(ROUTINES_STORAGE_KEY).toBeTruthy();
    expect(CUES_STORAGE_KEY).not.toBe(ROUTINES_STORAGE_KEY);
  });

  it('saves a cue under its slug id, lists it, and loads a record whose payload is the parsed spec', async () => {
    const s = cueStore();
    const spec = parsedSpec();
    await s.save('Look left', spec, 1000);
    expect(await s.list()).toEqual([{ id: 'look-left', name: 'Look left', createdAt: 1000 }]);
    const rec = await s.load('look-left');
    expect(rec?.cue).toEqual(spec);
  });

  it('loadStoredCues flattens every stored record to the runner shape', async () => {
    const s = cueStore();
    await s.save('Look left', parsedSpec(), 1000);
    await s.save('Eyebrows', parsedSpec({ instruction: 'Move your eyebrows however you like, and hold it.' }), 2000);
    const cues = await loadStoredCues(s);
    expect(cues.map((c) => c.id).sort()).toEqual(['eyebrows', 'look-left']);
    const eyebrows = cues.find((c) => c.id === 'eyebrows');
    expect(eyebrows).toMatchObject({ id: 'eyebrows', name: 'Eyebrows', produces: 'vocabulary' });
    expect(eyebrows && 'createdAt' in eyebrows).toBe(false);
  });

  it('rejects an invalid spec at save — the schema is the gate, not the panel that happened to call it', async () => {
    const s = cueStore();
    // A nuisance cue with no axes: type-valid, schema-invalid (the superRefine rule).
    const nuisanceWithoutAxes: CueSpec = {
      ...parsedSpec(),
      produces: 'nuisance',
      sufficiency: { kind: 'frames', minFrames: 90, patienceMs: 20000 },
    };
    await expect(s.save('Bad', nuisanceWithoutAxes)).rejects.toThrow();
    expect(await s.list()).toEqual([]);
  });

  it('mergeCues: a stored cue with a starter id replaces the starter IN PLACE, a new id appends, the rest are untouched', () => {
    const override = cue('look-left', ['face.head']);
    const custom = cue('eyebrows', ['face.geom.brow']);
    const merged = mergeCues(STARTER_CUES, [custom, override]);
    const starterIds = STARTER_CUES.map((c) => c.id);
    expect(merged.map((c) => c.id)).toEqual([...starterIds, 'eyebrows']);
    expect(merged[starterIds.indexOf('look-left')]).toBe(override);
    for (const [i, c] of STARTER_CUES.entries()) if (c.id !== 'look-left') expect(merged[i]).toBe(c);
    expect(mergeCues(STARTER_CUES, [])).toEqual([...STARTER_CUES]);
  });

  it('listCues over an empty store is exactly the starter set — starters are code, not seed rows', async () => {
    const { cues, unusable } = await listCues(cueStore());
    expect(cues).toEqual([...STARTER_CUES]);
    expect(unusable).toEqual([]);
  });

  it('listCues over a store that saved a cue under a starter name overrides that starter, at its position', async () => {
    const s = cueStore();
    const reworded = parsedSpec({ instruction: 'Look over your left shoulder, and hold it.' });
    await s.save('Look left', reworded, 1000);
    const { cues } = await listCues(s);
    expect(cues.map((c) => c.id)).toEqual([...DEFAULT_ROUTINE_CUE_IDS]);
    expect(cues[DEFAULT_ROUTINE_CUE_IDS.indexOf('look-left')].instruction).toBe(reworded.instruction);
  });

  it('listCues DROPS a stored cue none of whose groups the catalog knows, and says which', async () => {
    // The schema is modality-neutral and cannot know the catalog; a cue with no
    // resolvable group would never count a frame and end with a misleading "I could not
    // see you". This is the app-side place that knows, so it is the place that filters.
    const s = cueStore();
    await s.save('Elbow', parsedSpec({ collects: { groups: ['elbow.angle'], omit: [], axes: [] } }), 1000);
    await s.save('Partly', parsedSpec({ collects: { groups: ['elbow.angle', 'face.head'], omit: [], axes: [] } }), 1001);
    const { cues, unusable } = await listCues(s);
    expect(unusable).toEqual(['elbow']);
    expect(cues.some((c) => c.id === 'partly')).toBe(true);
    expect(cues.some((c) => c.id === 'elbow')).toBe(false);
  });

  it('loadRoutine(null) resolves the default routine in DEFAULT_ROUTINE_CUE_IDS order, named Default, nothing missing', async () => {
    const r = await loadRoutine(null, STARTER_CUES, routineStore());
    expect(r.name).toBe('Default');
    expect(r.missing).toEqual([]);
    expect(r.cues.map((c) => c.id)).toEqual([...DEFAULT_ROUTINE_CUE_IDS]);
  });

  it('loadRoutine with an unknown routine id falls back to the default rather than failing', async () => {
    const r = await loadRoutine('never-saved', STARTER_CUES, routineStore());
    expect(r.name).toBe('Default');
    expect(r.cues.map((c) => c.id)).toEqual([...DEFAULT_ROUTINE_CUE_IDS]);
  });

  it('loadRoutine with a saved routine that names a deleted cue reports it in missing and runs the rest', async () => {
    const routines = routineStore();
    await routines.save('Short', { cueIds: ['rest', 'gone', 'your-faces'] }, 1000);
    const r = await loadRoutine('short', STARTER_CUES, routines);
    expect(r.name).toBe('Short');
    expect(r.cues.map((c) => c.id)).toEqual(['rest', 'your-faces']);
    expect(r.missing).toEqual(['gone']);
  });

  it('createRoutineStore round-trips {cueIds} and rejects an empty routine', async () => {
    const routines = routineStore();
    await routines.save('Head only', { cueIds: ['rest', 'look-left', 'look-right'] }, 1000);
    expect(await routines.list()).toEqual([{ id: 'head-only', name: 'Head only', createdAt: 1000 }]);
    expect((await routines.load('head-only'))?.routine).toEqual({ cueIds: ['rest', 'look-left', 'look-right'] });
    await expect(routines.save('Empty', { cueIds: [] })).rejects.toThrow();
  });
});

// ---- 6. Picker filter ---------------------------------------------------------

describe('picker filter — free text and tag chips', () => {
  const tagged = (id: string, name: string, instruction: string, tags: string[]): Cue =>
    CueSchema.parse({ id, name, ...specInput({ instruction, tags }) });
  const CUES: Cue[] = [
    tagged('a', 'Look left', 'Turn your head to look to your left, and hold it.', ['face', 'pose']),
    tagged('b', 'Eyebrows', 'Move your eyebrows however you like, and hold it.', ['face', 'expression']),
    tagged('c', 'Pinch', 'Bring your thumb and index finger together, and hold it.', ['hand', 'pose']),
  ];

  it('free text matches the name or the instruction, case-insensitively, and trims the query', () => {
    expect(filterCues(CUES, 'LEFT').map((c) => c.id)).toEqual(['a']);
    expect(filterCues(CUES, 'eyebrows').map((c) => c.id)).toEqual(['b']);
    expect(filterCues(CUES, '  hold it  ').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(filterCues(CUES, '')).toEqual(CUES);
    expect(filterCues(CUES, 'nothing-like-this')).toEqual([]);
  });

  it('tags are ALL-of: a cue must carry every selected tag', () => {
    expect(filterCues(CUES, '', ['pose']).map((c) => c.id)).toEqual(['a', 'c']);
    expect(filterCues(CUES, '', ['face', 'pose']).map((c) => c.id)).toEqual(['a']);
    expect(filterCues(CUES, '', ['hand', 'expression'])).toEqual([]);
    // Text and tags combine.
    expect(filterCues(CUES, 'hold', ['face']).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('cueTags returns the distinct tags in first-seen order, so the chips are stable', () => {
    expect(cueTags(CUES)).toEqual(['face', 'pose', 'expression', 'hand']);
    expect(cueTags([])).toEqual([]);
  });

  it('the starter set carries tags the picker can filter on', () => {
    expect(cueTags(STARTER_CUES)).toContain('face');
    expect(filterCues(STARTER_CUES, '', ['setup']).map((c) => c.id)).toEqual(['rest', 'closer-and-further']);
  });
});
