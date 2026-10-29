// @vitest-environment jsdom
/**
 * The Sound mapper page's panel (`play/src/sound_mapper_view.ts`) over a real store with no hub:
 * Add a sound adds a row with its own drum, Play waits until a sound is taught, a taught tap and a
 * hit show up in place, and the page's wrapped actions are the ones the controls call.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createSoundMapperStore } from '@thoremin/sound-mapper/store';
import type { SoundMapRecord } from '@thoremin/sound-mapper/schema';
import { mountSoundMapper } from '../../play/src/sound_mapper_view';

function rig() {
  const store = createSoundMapperStore({ hub: () => null, provider: createInMemoryProvider<SoundMapRecord>([]), setTimer: () => 0, clearTimer: () => undefined });
  const root = document.createElement('main');
  document.body.replaceChildren(root);
  mountSoundMapper(root, store);
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const button = (text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;
  return { store, root, q, button };
}

describe('the Sound mapper page', () => {
  beforeEach(() => document.body.replaceChildren());

  it('adds sounds with their own drums, and Play waits until one is taught', () => {
    const { store, root, button } = rig();
    expect(root.dataset.testid).toBe('sound-mapper-panel');
    expect(button('Play').disabled).toBe(true);
    button('Add a sound').click();
    button('Add a sound').click();
    expect(root.querySelectorAll('[data-testid="sound-class"]')).toHaveLength(2);
    expect(new Set(store.getState().map.classes.map((c) => c.sound)).size).toBe(2);
    expect(button('Play').disabled).toBe(true);
  });

  it('shows a taught tap, enables Play, and lights the row a hit names', () => {
    const { store, root, button, q } = rig();
    button('Add a sound').click();
    const c = store.getState().map.classes[0];
    store.setState({ map: { ...store.getState().map, classes: [{ ...c, examples: [{ id: 't1', sampleRate: 48000, onset: 0, pcm: '' }] }] } });
    expect(q('[data-testid="sound-class-count"]').textContent).toBe('1 tap');
    expect(button('Teach more')).toBeTruthy();
    expect(button('Play').disabled).toBe(false);
    store.setState({ playing: true, hits: [{ frame: 1, classId: c.id, confidence: 0.9, latencyMs: 4.2, revised: false }] });
    expect(button('Stop')).toBeTruthy();
    expect(q('[data-testid="sound-hit"]').textContent).toContain(c.label);
    expect(q('[data-testid="sound-hit-ms"]').textContent).toBe('4.2 ms');
    expect(root.querySelector('.sm-row')!.classList.contains('lit')).toBe(true);
  });

  it('keeps a focused name field across a hit (rows are rebuilt only when the sounds change)', () => {
    const { store, button, q } = rig();
    button('Add a sound').click();
    const name = q<HTMLInputElement>('.sm-name');
    name.focus();
    store.setState({ playing: true, hits: [{ frame: 1, classId: null, confidence: 0.5, latencyMs: 3, revised: false }] });
    expect(document.activeElement).toBe(name);
    expect(q('[data-testid="sound-hit"]').textContent).toContain('Not one of yours');
  });

  it('calls the actions the page passes (which make its AudioContext first)', () => {
    const store = createSoundMapperStore({ hub: () => null, provider: createInMemoryProvider<SoundMapRecord>([]), setTimer: () => 0, clearTimer: () => undefined });
    const calls: string[] = [];
    const root = document.createElement('main');
    mountSoundMapper(root, store, { ...store.getState(), teach: (id) => void calls.push(`teach ${id}`) });
    store.getState().addClass('Pot');
    (root.querySelector('.sm-row button') as HTMLButtonElement).click();
    expect(calls).toEqual([`teach ${store.getState().map.classes[0].id}`]);
  });
});
