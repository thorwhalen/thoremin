// @vitest-environment jsdom
/**
 * The Chord wheel section of the settings panel (H5 of #613), rendered with the dials host
 * mocked: what it shows for a given `chordWheel` dial, and that every control writes its leaf
 * through `dispatchDialSetIn` (the single write path) with the right type. The conditional
 * parts are the point: the face's moves only while the face steers, the surprise source only
 * with the likeliest-on-top order (and its own amount only from this setting), the walk's step
 * only while walking, the order only for the key's moves, and everything disabled while off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const dials = vi.hoisted(() => ({ chordWheel: {} as Record<string, unknown>, setIn: vi.fn() }));
vi.mock('@thoremin/sdk-ui/dials', async (orig) => ({
  ...(await orig<object>()),
  useDialsSettings: () => ({ state: { effective: { chordWheel: dials.chordWheel } } }),
  dispatchDialSetIn: dials.setIn,
}));
import { ChordWheelControls } from '@thoremin/ext-harmony/panels/chordWheel';
import { useChordWheelStatus } from '@thoremin/ext-harmony/app/chordWheelStatus';
import { IDLE_CHORD_WHEEL_STATUS } from '@thoremin/ext-harmony/nodes/chord_wheel';
import { EMOTIONS } from '@thoremin/sdk/music/expression';

const show = (c: Record<string, unknown>) => {
  dials.chordWheel = c;
  return render(<ChordWheelControls />);
};
const select = (label: RegExp) => screen.getByText(label).closest('label')!.querySelector('select')!;
const range = (label: RegExp) => screen.getByText(label).closest('label')!.querySelector('input')!;

beforeEach(() => {
  dials.setIn.mockReset();
  useChordWheelStatus.getState().reset();
});
afterEach(cleanup);

describe('the Chord wheel section', () => {
  it('off: says so, and every control but the switch is disabled', () => {
    show({});
    expect(screen.getByTestId('chord-wheel-live').dataset.state).toBe('off');
    expect(screen.getByText(/^Off\./)).toBeTruthy();
    const box = screen.getByLabelText('Play the chord wheel') as HTMLInputElement;
    expect(box.checked).toBe(false);
    const controls = screen.getByTestId('chord-wheel-controls');
    const others = [...controls.querySelectorAll('select, input')].filter((el) => el !== box);
    expect(others.length).toBeGreaterThan(5);
    expect(others.every((el) => (el as HTMLInputElement).disabled)).toBe(true);
    fireEvent.click(box);
    expect(dials.setIn).toHaveBeenCalledWith('chordWheel.enabled', true);
  });

  it('shows the defaults when the dial is empty', () => {
    show({ enabled: true });
    expect(select(/^Moves/).value).toBe('diatonic');
    expect(select(/^Steer with/).value).toBe('hand');
    expect(select(/^Steering hand/).value).toBe('left');
    expect(screen.getByText('Wheel size (30% of the height)')).toBeTruthy();
    expect(screen.getByText('Push to choose (14% of the height)')).toBeTruthy();
    expect(screen.getByText('Hold for (3 frames)')).toBeTruthy();
    expect(select(/^Where each move sits/).value).toBe('fixed');
    expect(select(/^Tension shown/).value).toBe('off');
    expect(select(/^Keep time with/).value).toBe('tempo');
    expect(screen.queryByTestId('chord-wheel-face-moves')).toBeNull();
    expect(screen.queryByText(/^Surprise from/)).toBeNull();
    expect(screen.queryByText(/^A step every/)).toBeNull();
  });

  it('every control writes its leaf, numbers as numbers', () => {
    show({ enabled: true });
    fireEvent.change(select(/^Moves/), { target: { value: 'tonnetz' } });
    fireEvent.change(select(/^Steer with/), { target: { value: 'face' } });
    fireEvent.change(select(/^Steering hand/), { target: { value: 'right' } });
    fireEvent.change(range(/^Wheel size/), { target: { value: '0.4' } });
    fireEvent.change(range(/^Push to choose/), { target: { value: '0.2' } });
    fireEvent.change(range(/^Hold for/), { target: { value: '5' } });
    fireEvent.click(screen.getByLabelText('Hold a push to walk it on the beat'));
    fireEvent.change(select(/^Where each move sits/), { target: { value: 'likely' } });
    fireEvent.change(select(/^Tension shown/), { target: { value: select(/^Tension shown/).options[1].value } });
    fireEvent.change(select(/^Keep time with/), { target: { value: 'conductor' } });
    expect(dials.setIn.mock.calls).toEqual([
      ['chordWheel.moves', 'tonnetz'],
      ['chordWheel.steer', 'face'],
      ['chordWheel.hand', 'right'],
      ['chordWheel.radius', 0.4],
      ['chordWheel.reach', 0.2],
      ['chordWheel.enterFrames', 5],
      ['chordWheel.walk', true],
      ['chordWheel.order', 'likely'],
      ['chordWheel.tension', select(/^Tension shown/).options[1].value],
      ['chordWheel.clock', 'conductor'],
    ]);
  });

  it('steered by the face, each expression gets a move, its default named, and writes its own leaf', () => {
    show({ enabled: true, steer: 'both', faceMoves: { [EMOTIONS[0]]: 'none' } });
    const moves = screen.getByTestId('chord-wheel-face-moves');
    const selects = within(moves).getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects).toHaveLength(EMOTIONS.length);
    expect(selects[0].value).toBe('none');
    expect(selects[1].value).toBe('');
    expect(selects[1].options[0].textContent).toMatch(/^default \(/);
    fireEvent.change(selects[1], { target: { value: selects[1].options[2].value } });
    expect(dials.setIn).toHaveBeenCalledWith(`chordWheel.faceMoves.${EMOTIONS[1]}`, selects[1].options[2].value);
  });

  it('the Tonnetz wheel offers its own moves to the face, and no order', () => {
    show({ enabled: true, moves: 'tonnetz', steer: 'face' });
    const first = within(screen.getByTestId('chord-wheel-face-moves')).getAllByRole('combobox')[0] as HTMLSelectElement;
    const diatonic = (() => {
      cleanup();
      show({ enabled: true, moves: 'diatonic', steer: 'face' });
      return [...(within(screen.getByTestId('chord-wheel-face-moves')).getAllByRole('combobox')[0] as HTMLSelectElement).options].map((o) => o.value);
    })();
    expect([...first.options].map((o) => o.value)).not.toEqual(diatonic);
    cleanup();
    show({ enabled: true, moves: 'tonnetz' });
    expect(select(/^Where each move sits/).disabled).toBe(true);
  });

  it('the likeliest order offers a surprise source, and its own amount only from this setting', () => {
    show({ enabled: true, order: 'likely', surprise: 0.35 });
    expect(select(/^Surprise from/).value).toBe('dial');
    expect(screen.getByText('Surprise (35%)')).toBeTruthy();
    fireEvent.change(range(/^Surprise \(/), { target: { value: '0.5' } });
    fireEvent.change(select(/^Surprise from/), { target: { value: 'hand' } });
    expect(dials.setIn.mock.calls).toEqual([
      ['chordWheel.surprise', 0.5],
      ['chordWheel.surpriseFrom', 'hand'],
    ]);
    cleanup();
    show({ enabled: true, order: 'likely', surpriseFrom: 'face' });
    expect(screen.queryByText(/^Surprise \(/)).toBeNull();
  });

  it('while walking, the step can be set in beats', () => {
    show({ enabled: true, walk: true, walkBeats: 2 });
    expect(select(/^A step every/).value).toBe('2');
    expect([...select(/^A step every/).options].map((o) => o.textContent)).toEqual(['beat', '2 beats', '3 beats', '4 beats']);
    fireEvent.change(select(/^A step every/), { target: { value: '4' } });
    expect(dials.setIn).toHaveBeenCalledWith('chordWheel.walkBeats', 4);
  });

  it('the readout counts the moves made while playing', () => {
    useChordWheelStatus.getState().report({ ...IDLE_CHORD_WHEEL_STATUS, enabled: true, steering: true, chord: 'C', numeral: 'I', moveCount: 3 });
    show({ enabled: true });
    expect(screen.getByTestId('chord-wheel-live').dataset.state).toBe('playing');
    expect(screen.getByTitle('moves made').textContent).toBe('3');
    cleanup();
    useChordWheelStatus.getState().report({ ...IDLE_CHORD_WHEEL_STATUS, enabled: true });
    show({ enabled: true });
    expect(screen.getByTestId('chord-wheel-live').dataset.state).toBe('ready');
    expect(screen.queryByTitle('moves made')).toBeNull();
  });
});
