// @vitest-environment jsdom
/**
 * The air guitar's enrolment step (#249), in its settings section: name a chord, press
 * Learn, and after the countdown two seconds of the chord hand's live shape (the node's
 * `shape` output, through the `readAirShape` holder) are saved as that chord, the
 * vocabulary persisted and the classifier handed to the instrument through the hot store.
 * A name that is not a chord cannot be learned; no hand in view is an error, not a chord.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { ChordEnrolment } from '@/app/dials/panels/airGuitar';
import { ENROL_CAPTURE_S, ENROL_COUNTDOWN_S, ENROL_SETTLE_MS } from '@/app/air/VocabularyEnrolment';
import { setShape } from '@/app/air/shapeTap';
import { AIR_GUITAR_NODE_ID } from '@/app/airGuitarStatus';
import { useGuitarVocabulary, useVocabularyStore, GUITAR_VOCABULARY, createVocabularyStore, type VocabularyRecord } from '@/app/air/vocabularyStore';
import { useControls } from '@/app/store';
import { emptyVocabulary } from '@/air/vocabulary';
import { chordShapeFeatureIds } from '@/features/hand_shape';
import { enrolSamples } from './air/synthetic_guitar';

let provider: ReturnType<typeof createInMemoryProvider<VocabularyRecord>>;

beforeEach(() => {
  provider = createInMemoryProvider<VocabularyRecord>([], { searchFields: ['name'] });
  useVocabularyStore(provider);
  useGuitarVocabulary.setState({ vocab: emptyVocabulary(chordShapeFeatureIds()), loaded: true, error: null });
  useControls.getState().setAirGuitarModel(null);
  setShape(AIR_GUITAR_NODE_ID, null);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  useVocabularyStore(null);
});

/** Run the countdown, then feed `shapes` one per poll through the capture window. */
function runCapture(shapes: (() => Record<string, number> | null)) {
  act(() => vi.advanceTimersByTime(ENROL_COUNTDOWN_S * 1000));
  const steps = Math.ceil((ENROL_SETTLE_MS + ENROL_CAPTURE_S * 1000) / 30) + 5;
  for (let i = 0; i < steps; i++) {
    setShape(AIR_GUITAR_NODE_ID, shapes());
    act(() => vi.advanceTimersByTime(30));
  }
}

describe('learning a chord', () => {
  it('captures the held shape as the named chord, saves it and trains the instrument', async () => {
    render(<ChordEnrolment enabled />);
    expect(screen.getByText(/None yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Chord to learn'), { target: { value: 'g' } });
    fireEvent.click(screen.getByText('Learn'));
    expect(screen.getByRole('status').textContent).toMatch(/Make your G shape/);
    const samples = enrolSamples('G', 200, 4);
    let i = 0;
    runCapture(() => samples[i++]);
    vi.useRealTimers();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const vocab = useGuitarVocabulary.getState().vocab;
    expect(vocab.entries.map((e) => e.label)).toEqual(['G']);
    // Two seconds after the settle, thinned to the stored maximum.
    expect(vocab.entries[0].samples.length).toBe(40);
    expect(useControls.getState().airGuitarModel?.categories.map((c) => c.label)).toEqual(['G']);
    const saved = await createVocabularyStore(provider).load(GUITAR_VOCABULARY);
    expect(saved?.vocabulary.entries[0].label).toBe('G');
    expect(screen.getByText('G')).toBeTruthy();
  });

  it('skips the frames while the hand settles into the shape', () => {
    render(<ChordEnrolment enabled />);
    fireEvent.change(screen.getByLabelText('Chord to learn'), { target: { value: 'G' } });
    fireEvent.click(screen.getByText('Learn'));
    act(() => vi.advanceTimersByTime(ENROL_COUNTDOWN_S * 1000));
    // Shapes offered only during the settle window are not taken.
    for (let i = 0; i < Math.floor(ENROL_SETTLE_MS / 30) - 1; i++) {
      setShape(AIR_GUITAR_NODE_ID, { 'index.curl': i });
      act(() => vi.advanceTimersByTime(30));
    }
    expect(screen.getByRole('status').textContent).toMatch(/\(0 samples\)/);
  });

  it('says so when two learned chords look alike', async () => {
    const { useGuitarVocabulary: v } = await import('@/app/air/vocabularyStore');
    const { withEntry } = await import('@/air/vocabulary');
    let vocab = emptyVocabulary(chordShapeFeatureIds());
    vocab = withEntry(vocab, 'G', enrolSamples('G', 30, 1));
    vocab = withEntry(vocab, 'G7', enrolSamples('G', 30, 2)); // the same shape, another name
    vocab = withEntry(vocab, 'D', enrolSamples('D', 30, 3));
    v.setState({ vocab });
    render(<ChordEnrolment enabled />);
    expect(screen.getAllByText(/looks like G/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/looks like D/)).toBeNull();
  });

  it('reports a failed save, and still plays what was learned', async () => {
    useVocabularyStore({
      ...provider,
      create: () => Promise.reject(new Error('quota exceeded')),
      update: () => Promise.reject(new Error('quota exceeded')),
    } as typeof provider);
    vi.useRealTimers();
    await useGuitarVocabulary.getState().enrol('G', enrolSamples('G', 20, 9));
    expect(useGuitarVocabulary.getState().error).toMatch(/quota exceeded/);
    expect(useControls.getState().airGuitarModel?.categories.map((c) => c.label)).toEqual(['G']);
  });

  it('will not learn a name that is not a chord', () => {
    render(<ChordEnrolment enabled />);
    fireEvent.change(screen.getByLabelText('Chord to learn'), { target: { value: 'my shape' } });
    expect((screen.getByText('Learn') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Not a chord name/)).toBeTruthy();
  });

  it('reports no chord hand instead of learning nothing', () => {
    render(<ChordEnrolment enabled />);
    fireEvent.change(screen.getByLabelText('Chord to learn'), { target: { value: 'C' } });
    fireEvent.click(screen.getByText('Learn'));
    runCapture(() => null);
    expect(screen.getByText(/No chord hand was seen/)).toBeTruthy();
    expect(useGuitarVocabulary.getState().vocab.entries).toEqual([]);
  });

  it('needs the air guitar on (it watches the chord hand through the node)', () => {
    render(<ChordEnrolment enabled={false} />);
    fireEvent.change(screen.getByLabelText('Chord to learn'), { target: { value: 'C' } });
    expect((screen.getByText('Learn') as HTMLButtonElement).disabled).toBe(true);
  });
});
