/**
 * Category readers as pools (#600 S10b): a branch declares `categories` (a `category-scores`
 * stream, its kind and a priority) instead of naming an input of the overlay, and the composer
 * allocates the overlay's pool for that kind by priority, highest first; a classifier's captions
 * (`categoryCaptions`) go to the input beside its reader's slot, whichever branch declares them.
 * The overlay then draws the first reader that reads, classifiers first, else a categorizer at
 * rest (`pickCategories`).
 */
import { describe, expect, it } from 'vitest';
import { composeGraph, ComposeError, defineBranch, type CategoryTarget } from '@/instruments';
import { captionsPort, categoryPool, categoryPoolInputs } from '@/nodes/output/canvas_overlay.schema';
import { pickCategories } from '@/nodes/output/canvas_overlay';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';
import type { CategoryKind } from '@thoremin/sdk/instruments/branch';

const TARGET: CategoryTarget = { node: 'overlay', pools: { classifier: categoryPool('classifier', 2), categorizer: categoryPool('categorizer', 2) }, captions: captionsPort };
const overlay = defineBranch({ id: 'overlay', nodes: [{ id: 'overlay', type: 'canvas-overlay' }] });
const reader = (id: string, kind: CategoryKind, priority: number) =>
  defineBranch({ id, nodes: [{ id, type: 'reader' }], categories: [{ from: { node: id, port: 'reading' }, kind, priority }] });
const inputOf = (edges: { from: { node: string; port: string }; to: { node: string; port: string } }[], from: string, port = 'reading') =>
  edges.find((e) => e.from.node === from && e.from.port === port && e.to.node === 'overlay')?.to.port;

describe('the category pools', () => {
  it('allocate each kind by priority, highest first, whatever the branch order', () => {
    const lib = [overlay, reader('low', 'categorizer', 5), reader('high', 'categorizer', 30), reader('asl', 'classifier', 1)];
    const { spec } = composeGraph(['overlay', 'low', 'high', 'asl'], lib, { categories: TARGET });
    expect([inputOf(spec.edges, 'high'), inputOf(spec.edges, 'low'), inputOf(spec.edges, 'asl')]).toEqual(['categorizer1', 'categorizer2', 'classifier1']);
  });

  it('wire a classifier\'s captions beside its slot, from another branch', () => {
    const chords = defineBranch({ id: 'chords', requires: ['asl'], nodes: [{ id: 'chords', type: 'sign-chord' }], categoryCaptions: [{ from: { node: 'chords', port: 'captions' }, for: { node: 'asl', port: 'reading' } }] });
    const lib = [overlay, reader('first', 'classifier', 9), reader('asl', 'classifier', 1), chords];
    const { spec } = composeGraph(['overlay', 'first', 'chords'], lib, { categories: TARGET });
    expect(inputOf(spec.edges, 'asl')).toBe('classifier2');
    expect(inputOf(spec.edges, 'chords', 'captions')).toBe('classifier2Captions');
  });

  it('wire nothing without the overlay (no cues to draw), and need no target when nothing reads', () => {
    expect(composeGraph(['low'], [reader('low', 'categorizer', 5)], { categories: TARGET }).spec.edges).toEqual([]);
    expect(composeGraph(['overlay'], [overlay], {}).spec.edges).toEqual([]);
    // ...but the declarations are still checked: a bad one fails in a test without the overlay too.
    const twice = defineBranch({ id: 'twice', requires: ['low'], categories: [{ from: { node: 'low', port: 'reading' }, kind: 'categorizer', priority: 1 }] });
    expect(() => composeGraph(['twice'], [reader('low', 'categorizer', 5), twice], { categories: TARGET })).toThrow(/declared by branches/);
    const ghost = defineBranch({ id: 'ghost', categories: [{ from: { node: 'nobody', port: 'reading' }, kind: 'categorizer', priority: 1 }] });
    expect(() => composeGraph(['ghost'], [ghost], { categories: TARGET })).toThrow(/node "nobody" is not in it/);
  });

  it('refuse a full pool, a missing target, a reader declared twice, and captions for no classifier', () => {
    const lib = [overlay, ...['p1', 'p2', 'p3'].map((id, i) => reader(id, 'categorizer', i))];
    expect(() => composeGraph(lib.map((b) => b.id), lib, { categories: TARGET })).toThrow(/category pool "categorizer" is full \(2 inputs\)/);
    expect(() => composeGraph(['overlay', 'p1'], lib, {})).toThrow(ComposeError);
    const twice = defineBranch({ id: 'twice', requires: ['p1'], categories: [{ from: { node: 'p1', port: 'reading' }, kind: 'categorizer', priority: 1 }] });
    expect(() => composeGraph(['overlay', 'p1', 'twice'], [...lib, twice], { categories: TARGET })).toThrow(/category reader p1.reading is declared by branches/);
    const orphan = defineBranch({ id: 'orphan', requires: ['p1'], categoryCaptions: [{ from: { node: 'p1', port: 'x' }, for: { node: 'p1', port: 'reading' } }] });
    expect(() => composeGraph(['overlay', 'orphan'], [...lib, orphan], { categories: TARGET })).toThrow(/a categorizer; only a classifier's classes carry captions/);
    const nowhere = defineBranch({ id: 'nowhere', requires: ['overlay'], nodes: [{ id: 'cap', type: 'x' }], categoryCaptions: [{ from: { node: 'cap', port: 'x' }, for: { node: 'gone', port: 'reading' } }] });
    expect(() => composeGraph(['nowhere'], [overlay, nowhere], { categories: TARGET })).toThrow(/which no composed branch declares as a category reader/);
  });

  it('the overlay\'s pool inputs: each slot, and each classifier slot\'s captions', () => {
    expect(categoryPoolInputs({ classifier: 1, categorizer: 2 }).map((p) => `${p.name}:${p.kind}`)).toEqual([
      'classifier1:category-scores',
      'classifier1Captions:string[]',
      'categorizer1:category-scores',
      'categorizer2:category-scores',
    ]);
  });
});

describe('pickCategories', () => {
  const scores = (label: string, present: boolean): CategoryScores => ({ present, label: present ? label : null, labels: [label], scores: [present ? 1 : 0] });
  const asl = scores('A', true);
  const aslIdle = scores('A', false);
  const pose = scores('ready', true);
  const poseIdle = scores('ready', false);
  const chord = scores('fist', true);
  const chordIdle = scores('fist', false);

  it('the first reading slot wins, classifiers first, each pool in priority order', () => {
    expect(pickCategories([{ scores: asl, captions: ['C'] }], [{ scores: pose }, { scores: chord }])).toEqual({ categories: asl, categoryCaptions: ['C'] });
    expect(pickCategories([{ scores: aslIdle, captions: ['C'] }], [{ scores: pose }, { scores: chord }])).toEqual({ categories: pose, categoryCaptions: null });
    expect(pickCategories([{ scores: aslIdle }], [{ scores: poseIdle }, { scores: chord }])).toEqual({ categories: chord, categoryCaptions: null });
  });

  it('with none reading: the first wired categorizer, else the first classifier with its captions', () => {
    expect(pickCategories([{ scores: aslIdle, captions: ['C'] }], [{ scores: poseIdle }, { scores: chordIdle }]).categories).toBe(poseIdle);
    expect(pickCategories([{ scores: aslIdle, captions: ['C'] }], [{ scores: undefined }, { scores: chordIdle }]).categories).toBe(chordIdle);
    expect(pickCategories([{ scores: aslIdle, captions: ['C'] }], [{ scores: null }])).toEqual({ categories: aslIdle, categoryCaptions: ['C'] });
    expect(pickCategories([{ scores: undefined, captions: undefined }], [])).toEqual({ categories: undefined, categoryCaptions: undefined });
    expect(pickCategories([], [])).toEqual({ categories: undefined, categoryCaptions: undefined });
  });
});
