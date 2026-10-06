// @vitest-environment jsdom
/**
 * The sequence trainer (#263) in an instrument's settings: pick or type a list, press
 * Start, and the panel shows the lead-in, then each target's countdown with the NEXT
 * target already named, then the hold; when the list ends every held target is enrolled
 * through the vocabulary store (the same path as Learn), a disputed one is offered
 * "Learn anyway", an invalid label blocks Start, and a typed list can be saved and comes
 * back in the picker. The guitar's chords are the vocabulary here; the flute's notes use
 * the same component.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { SEQUENCE_HUSH_ID, SequenceTrainer } from '@thoremin/ext-air/app/SequenceTrainer';
import { setShape, readShape } from '@thoremin/ext-air/app/shapeTap';
import { AIR_GUITAR_NODE_ID } from '@thoremin/ext-air/app/airGuitarStatus';
import { useGuitarVocabulary, useVocabularyStore, type VocabularyRecord } from '@thoremin/ext-air/app/vocabularyStore';
import { useSequenceStore, listSequences } from '@thoremin/sdk-ui/enroll/sequenceStore';
import { GUITAR_STARTER_SEQUENCES } from '@thoremin/ext-air/app/starterSequences';
import { useControls } from '@/app/store';
import { emptyVocabulary } from '@thoremin/ext-air/lib/vocabulary';
import { chordShapeFeatureIds } from '@thoremin/ext-air/lib/hand_shape';
import { parseChordName } from '@thoremin/ext-air/lib/guitar';
import type { SequenceRecord, TargetCheck } from '@thoremin/sdk/enroll';
import { enrolSamples } from './air/synthetic_guitar';
import { AIR } from './helpers/extensions';

const WORDS = { title: 'Learn a sequence of chords', noun: 'chord', placeholder: 'Or type chords', offHint: 'Turn the air guitar on' };

let provider: ReturnType<typeof createInMemoryProvider<VocabularyRecord>>;
let sequences: ReturnType<typeof createInMemoryProvider<SequenceRecord>>;

beforeEach(() => {
  provider = createInMemoryProvider<VocabularyRecord>([], { searchFields: ['name'] });
  sequences = createInMemoryProvider<SequenceRecord>([], { searchFields: ['name'] });
  useVocabularyStore(provider);
  useSequenceStore(sequences);
  useGuitarVocabulary.setState({ vocab: emptyVocabulary(chordShapeFeatureIds()), loaded: true, error: null });
  useControls.getState().setTransient('airGuitarModel', null);
  setShape(AIR_GUITAR_NODE_ID, null);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  useVocabularyStore(null);
  useSequenceStore(null);
});

function trainer(props: { enabled?: boolean; makeCheck?: () => TargetCheck | undefined } = {}) {
  return (
    <SequenceTrainer
      enabled={props.enabled ?? true}
      useVocabulary={useGuitarVocabulary}
      readShape={() => readShape(AIR_GUITAR_NODE_ID)}
      canonical={(typed) => parseChordName(typed)?.name ?? null}
      makeCheck={props.makeCheck}
      starters={GUITAR_STARTER_SEQUENCES}
      words={WORDS}
    />
  );
}

/** Let the async list load settle. */
const settle = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

/** Advance `ms` in 30 ms polls, offering a fresh shape object each poll when `shapes` is given. */
function run(ms: number, shapes?: () => Record<string, number>) {
  for (let t = 0; t < ms; t += 30) {
    if (shapes) setShape(AIR_GUITAR_NODE_ID, shapes());
    act(() => vi.advanceTimersByTime(30));
  }
}

describe.runIf(AIR)('the sequence trainer', () => {
  it('walks a typed list: lead-in, next target named ahead, hold, then enrols every held target', async () => {
    render(trainer());
    await settle();
    fireEvent.change(screen.getByLabelText('Or type the chords'), { target: { value: 'G C' } });
    expect(screen.getByTestId('sequence-preview').textContent).toMatch(/G C — 2 chords/);
    fireEvent.click(screen.getByText('Start'));
    expect(screen.getByTestId('sequence-trainer').getAttribute('data-phase')).toBe('lead-in');
    expect(screen.getByRole('status').textContent).toMatch(/Get ready… 3\. First: G/);
    // The instrument is hushed while the sequence runs (#264's claim), and released after.
    const hushed = () => useControls.getState().hushedBy.some((id) => id.startsWith(SEQUENCE_HUSH_ID));
    expect(hushed()).toBe(true);

    run(3000);
    expect(screen.getByTestId('sequence-trainer').getAttribute('data-phase')).toBe('countdown');
    expect(screen.getByRole('status').textContent).toMatch(/Next: G in 3/);
    expect(screen.getByTestId('sequence-next').textContent).toMatch(/Then: C/);

    run(3000);
    expect(screen.getByTestId('sequence-trainer').getAttribute('data-phase')).toBe('hold');
    expect(screen.getByRole('status').textContent).toMatch(/Hold G/);
    const g = enrolSamples('G', 120, 4);
    let i = 0;
    run(2300, () => g[i++]);
    // C's countdown: the last one.
    expect(screen.getByRole('status').textContent).toMatch(/Next: C/);
    expect(screen.getByTestId('sequence-next').textContent).toMatch(/Last one/);
    run(3000);
    const c = enrolSamples('C', 120, 5);
    let j = 0;
    run(2300, () => c[j++]);

    expect(screen.getByTestId('sequence-trainer').getAttribute('data-phase')).toBe('done');
    expect(hushed()).toBe(false);
    const rows = screen.getByTestId('sequence-outcomes').textContent;
    expect(rows).toMatch(/G.*learned/);
    expect(rows).toMatch(/C.*learned/);
    await settle();
    expect(useGuitarVocabulary.getState().vocab.entries.map((e) => e.label)).toEqual(['G', 'C']);
    expect(useControls.getState().airGuitarModel?.categories.map((x) => x.label)).toEqual(['G', 'C']);
  });

  it('reports a hold nothing was seen in, and offers to learn a disputed one anyway', async () => {
    const check: TargetCheck = (label) => (label === 'C' ? { kind: 'mismatch', read: 'G', margin: 0.8 } : { kind: 'ok' });
    render(trainer({ makeCheck: () => check }));
    await settle();
    fireEvent.change(screen.getByLabelText('Or type the chords'), { target: { value: 'G C D' } });
    fireEvent.click(screen.getByText('Start'));
    run(3000); // lead-in
    run(3000); // G countdown
    const g = enrolSamples('G', 120, 4);
    let i = 0;
    run(2300, () => g[i++]);
    run(3000); // C countdown
    const c = enrolSamples('C', 120, 5);
    let j = 0;
    run(2300, () => c[j++]);
    run(3000); // D countdown
    setShape(AIR_GUITAR_NODE_ID, null);
    run(2300); // nothing seen
    expect(screen.getByTestId('sequence-trainer').getAttribute('data-phase')).toBe('done');
    const rows = screen.getByTestId('sequence-outcomes').textContent;
    expect(rows).toMatch(/G.*learned/);
    expect(rows).toMatch(/C.*looked like G/);
    expect(rows).toMatch(/D.*nothing seen/);
    await settle();
    expect(useGuitarVocabulary.getState().vocab.entries.map((e) => e.label)).toEqual(['G']);
    fireEvent.click(screen.getByText('Learn anyway'));
    await settle();
    expect(useGuitarVocabulary.getState().vocab.entries.map((e) => e.label)).toEqual(['G', 'C']);
    expect(screen.queryByText('Learn anyway')).toBeNull();
  });

  it('blocks Start on a label that is not a chord, and while the instrument is off', async () => {
    render(trainer());
    await settle();
    fireEvent.change(screen.getByLabelText('Or type the chords'), { target: { value: 'G Zz' } });
    expect(screen.getByText(/Not a chord: Zz/)).toBeTruthy();
    expect((screen.getByText('Start') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(trainer({ enabled: false }));
    await settle();
    expect((screen.getByText('Start') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Turn the air guitar on', { exact: false })).toBeTruthy();
  });

  it('offers the starters, runs a chosen one, and saves a typed list under a name', async () => {
    render(trainer());
    await settle();
    const picker = screen.getByLabelText('Sequence') as HTMLSelectElement;
    expect(picker.options.length).toBe(GUITAR_STARTER_SEQUENCES.length);
    expect(screen.getByTestId('sequence-preview').textContent).toMatch(/G C D — 3 chords/);
    fireEvent.change(screen.getByLabelText('Or type the chords'), { target: { value: 'Em Am' } });
    fireEvent.change(screen.getByLabelText('Name to save the sequence under'), { target: { value: 'minor pair' } });
    fireEvent.click(screen.getByText('Save'));
    await settle();
    await settle();
    const all = await listSequences(GUITAR_STARTER_SEQUENCES);
    expect(all.find((s) => s.name === 'minor pair')?.spec.targets.map((t) => t.label)).toEqual(['Em', 'Am']);
    expect((screen.getByLabelText('Sequence') as HTMLSelectElement).options.length).toBe(GUITAR_STARTER_SEQUENCES.length + 1);
  });

  it('unmounted mid-run, it ends the run as Stop would: what was held is enrolled, the hush released', async () => {
    const { unmount } = render(trainer());
    await settle();
    fireEvent.change(screen.getByLabelText('Or type the chords'), { target: { value: 'G C' } });
    fireEvent.click(screen.getByText('Start'));
    run(6000);
    const g = enrolSamples('G', 120, 4);
    let i = 0;
    run(2300, () => g[i++]);
    run(1000); // into C's countdown
    unmount();
    expect(useControls.getState().hushedBy.some((id) => id.startsWith(SEQUENCE_HUSH_ID))).toBe(false);
    await settle();
    expect(useGuitarVocabulary.getState().vocab.entries.map((e) => e.label)).toEqual(['G']);
    // Nothing keeps polling: no timer fires after unmount (would throw on a torn-down tree).
    act(() => vi.advanceTimersByTime(5000));
  });

  it('Stop ends the run and keeps what was held so far', async () => {
    render(trainer());
    await settle();
    fireEvent.change(screen.getByLabelText('Or type the chords'), { target: { value: 'G C' } });
    fireEvent.click(screen.getByText('Start'));
    run(6000);
    const g = enrolSamples('G', 120, 4);
    let i = 0;
    run(2300, () => g[i++]);
    fireEvent.click(screen.getByText('Stop'));
    expect(screen.getByTestId('sequence-trainer').getAttribute('data-phase')).toBe('stopped');
    await settle();
    expect(useGuitarVocabulary.getState().vocab.entries.map((e) => e.label)).toEqual(['G']);
    expect(screen.getByText('Start')).toBeTruthy();
  });
});
