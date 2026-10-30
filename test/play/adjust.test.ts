// @vitest-environment jsdom
/**
 * The Adjust panel (`play/src/adjust.ts`): sliders by setting name, a move tells the page at once and
 * is kept in this browser per game, a new difficulty moves only an untouched knob, Reset puts the
 * defaults back, and the spec bar saves and opens the knobs like any other control.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountAdjust } from '../../play/src/adjust';
import { mountSpecBar } from '../../play/src/spec_bar';
import { gameSpec } from '@thoremin/games/spec';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<header></header>';
});

const knobs = [
  { key: 'size', label: 'Balloon size', value: 1 },
  { key: 'holdS', label: 'Hold to pop', value: 1 },
] as const;

function mount(seen: object[] = []) {
  return mountAdjust({ game: 'pop-the-notes', host: document.querySelector('header')!, knobs, onChange: (v) => seen.push(v) });
}

const drag = (el: HTMLInputElement, v: number) => {
  el.value = String(v);
  el.dispatchEvent(new Event('input'));
};

describe('the Adjust panel', () => {
  it('tells the page on a move, keeps it per game, and a difficulty moves only what was not touched', () => {
    const seen: object[] = [];
    const a = mount(seen);
    expect(a.values()).toEqual({ size: 1, holdS: 1 });
    drag(a.inputs.size!, 1.5);
    expect(seen.at(-1)).toEqual({ size: 1.5, holdS: 1 });
    expect(document.querySelector('.adjust output')!.textContent).toBe('150 %');
    a.setDefault('holdS', 0.7);
    a.setDefault('size', 0.8);
    expect(a.values()).toEqual({ size: 1.5, holdS: 0.7 });
    // Next visit: the moved knob comes back, the other takes the page's default.
    document.body.innerHTML = '<header></header>';
    expect(mount().values()).toEqual({ size: 1.5, holdS: 1 });
  });

  it('Reset puts the defaults back and forgets what was kept', () => {
    const a = mount();
    drag(a.inputs.holdS!, 2);
    (document.querySelector('.adjust button') as HTMLButtonElement).click();
    expect(a.values()).toEqual({ size: 1, holdS: 1 });
    expect(localStorage.getItem('funfon.adjust.pop-the-notes')).toBeNull();
  });

  it('the spec bar saves the knobs and opening a spec sets them', () => {
    const seen: object[] = [];
    const a = mount(seen);
    const bar = mountSpecBar({ game: 'pop-the-notes', host: document.querySelector('header')!, controls: a.inputs });
    drag(a.inputs.size!, 2);
    expect(bar.settings()).toEqual({ size: 2, holdS: 1 });
    bar.apply(gameSpec('pop-the-notes', { size: 0.5, holdS: 1.5 }));
    expect(a.values()).toEqual({ size: 0.5, holdS: 1.5 });
    expect(seen.at(-1)).toEqual({ size: 0.5, holdS: 1.5 });
  });

  it('a spec at the defaults pins nothing, and a spec without a knob puts it back to its default', () => {
    const a = mount();
    const bar = mountSpecBar({ game: 'pop-the-notes', host: document.querySelector('header')!, controls: a.inputs });
    bar.apply(gameSpec('pop-the-notes', { size: 1, holdS: 1 }));
    // The difficulty still sets the hold: nothing was moved off its default.
    a.setDefault('holdS', 0.7);
    expect(a.values().holdS).toBe(0.7);
    drag(a.inputs.size!, 2);
    bar.apply(gameSpec('pop-the-notes', {}));
    expect(a.values()).toEqual({ size: 1, holdS: 0.7 });
  });

  it('a kept value for a knob this page no longer has is ignored', () => {
    localStorage.setItem('funfon.adjust.pop-the-notes', JSON.stringify({ tolerance: 40, size: 1.2 }));
    const a = mount();
    expect(() => drag(a.inputs.size!, 1.4)).not.toThrow();
    expect(JSON.parse(localStorage.getItem('funfon.adjust.pop-the-notes')!)).toEqual({ size: 1.4 });
  });
});
