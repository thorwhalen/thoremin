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
import { ChordEnrolment, ENROL_CAPTURE_S, ENROL_COUNTDOWN_S } from '@/app/dials/panels/airGuitar';
import { setAirShape } from '@/app/airGuitarStatus';
import { useGuitarVocabulary, useVocabularyStore, GUITAR_VOCABULARY, createVocabularyStore, type VocabularyRecord } from '@/app/air/vocabularyStore';
import { useControls } from '@/app/store';
import { emptyVocabulary } from '@/air/vocabulary';
import { chordShapeFeatureIds } from '@/features/hand_shape';
import { enrolSamples } from './air/synthetic_guitar';

let provider: ReturnType<typeof createInMemoryProvider<VocabularyRecord>>;

beforeEach(() => {
  provider = createInMemoryProvider<VocabularyRecord>([], { searchFields: ['name'] });
  useVocabularyStore(provider);
  useGuitarVocabulary.setState({ vocab: emptyVocabulary(chordShapeFeatureIds()), loaded: true });
  useControls.getState().setAirGuitarModel(null);
  setAirShape(null);
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
  const steps = Math.ceil((ENROL_CAPTURE_S * 1000) / 30) + 5;
  for (let i = 0; i < steps; i++) {
    setAirShape(shapes());
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
    expect(vocab.entries[0].samples.length).toBeGreaterThanOrEqual(40);
    expect(useControls.getState().airGuitarModel?.categories.map((c) => c.label)).toEqual(['G']);
    const saved = await createVocabularyStore(provider).load(GUITAR_VOCABULARY);
    expect(saved?.vocabulary.entries[0].label).toBe('G');
    expect(screen.getByText('G')).toBeTruthy();
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
