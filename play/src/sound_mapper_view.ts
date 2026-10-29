/**
 * The Sound mapper page's panel, in plain DOM (`play/sound-mapper.html`): the player's sounds (a
 * name, the drum it plays, how many taps taught it, Teach), Play, what was just heard and how fast,
 * and the few settings that trade speed for sureness. It only renders the store
 * (`@thoremin/sound-mapper/store`) and calls it, through `actions` (the page wraps the ones that
 * need sound so they first make its AudioContext, inside the click).
 *
 * The sound rows are rebuilt only when the map's classes change; what changes on every hit (the
 * lit row, the readout) is updated in place, so a focused name or a dragged slider is never
 * replaced under the player's hand.
 */
import { KIT_LABELS, KIT_SOUNDS, type KitSound } from '@thoremin/sdk/audio/kit';
import { describeInput } from '@thoremin/sound-mapper/describe';
import { SOUND_MAPPER_LIMITS, type SoundClass } from '@thoremin/sound-mapper/schema';
import type { SoundMapperState, SoundMapperStore } from '@thoremin/sound-mapper/store';

/** What the panel may ask of the page: the store's verbs, possibly wrapped. */
export type SoundMapperActions = Pick<SoundMapperState, 'addClass' | 'removeClass' | 'renameClass' | 'setSound' | 'clearClass' | 'setParams' | 'teach' | 'play'>;

type Params = Parameters<SoundMapperState['setParams']>[0];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { testid?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const { testid, ...rest } = props;
  const e = Object.assign(document.createElement(tag), rest);
  if (testid) e.dataset.testid = testid;
  e.append(...kids);
  return e;
}

/** Mount the panel into `root`; returns the unsubscribe. */
export function mountSoundMapper(root: HTMLElement, store: SoundMapperStore, actions: SoundMapperActions = store.getState()): () => void {
  root.dataset.testid = 'sound-mapper-panel';
  const rows = el('div', { className: 'sm-rows' });
  const add = el('button', { type: 'button', className: 'sm-add', textContent: 'Add a sound', onclick: () => void actions.addClass() });
  const play = el('button', { type: 'button', className: 'sm-play', onclick: () => void actions.play(!store.getState().playing) });
  const input = el('p', { className: 'sm-note', testid: 'sound-input' });
  const error = el('p', { className: 'sm-error' });
  const hit = el('div', { className: 'sm-hit' });

  const slider = (label: string, key: keyof Params, min: number, max: number, step: number, unit: string) => {
    const value = el('span', { className: 'sm-value' });
    const range = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    range.setAttribute('aria-label', label);
    range.addEventListener('input', () => actions.setParams({ [key]: Number(range.value) } as Params));
    const show = (v: number) => {
      value.textContent = unit === '%' ? `${Math.round(v * 100)}%` : `${v} ${unit}`;
      if (document.activeElement !== range) range.value = String(v);
    };
    return { row: el('label', { className: 'sm-slider' }, el('span', {}, `${label} `, value), range), show, key };
  };
  const sliders = [
    slider('Listen before playing', 'windowMs', SOUND_MAPPER_LIMITS.windowMs[0], SOUND_MAPPER_LIMITS.windowMs[1], 1, 'ms'),
    slider('Then check for', 'refineMs', SOUND_MAPPER_LIMITS.refineMs[0], SOUND_MAPPER_LIMITS.refineMs[1], 1, 'ms'),
    slider('Harder tap, louder drum', 'velocity', 0, 1, 0.05, '%'),
    slider('Drum volume', 'gain', 0, 1.5, 0.05, '%'),
  ];
  const feel = el(
    'details',
    { className: 'sm-feel' },
    el('summary', {}, 'Speed and feel'),
    ...sliders.map((s) => s.row),
    el('p', { className: 'sm-note' }, 'The drum starts after the first window; a longer one is surer but later. If the second window hears a different sound, the drum is swapped (set it to 0 to never swap).'),
  );
  root.replaceChildren(rows, add, play, input, error, hit, feel);

  const rowFor = (c: SoundClass, teaching: boolean) => {
    const name = el('input', { className: 'sm-name', value: c.label });
    name.setAttribute('aria-label', 'Sound name');
    name.addEventListener('blur', () => actions.renameClass(c.id, name.value));
    const drum = el('select', { className: 'sm-drum' });
    drum.setAttribute('aria-label', `Drum for ${c.label}`);
    for (const k of KIT_SOUNDS) drum.add(new Option(KIT_LABELS[k], k, false, k === c.sound));
    drum.addEventListener('change', () => actions.setSound(c.id, drum.value as KitSound));
    const n = c.examples.length;
    const teach = el('button', { type: 'button', className: teaching ? 'sm-teaching' : 'sm-quiet', textContent: teaching ? 'Done' : n ? 'Teach more' : 'Teach', onclick: () => actions.teach(teaching ? null : c.id) });
    const clear = el('button', { type: 'button', className: 'sm-quiet', textContent: 'Clear', disabled: n === 0, onclick: () => actions.clearClass(c.id) });
    const remove = el('button', { type: 'button', className: 'sm-quiet', textContent: 'Remove', onclick: () => actions.removeClass(c.id) });
    remove.setAttribute('aria-label', `Remove ${c.label}`);
    const row = el(
      'div',
      { className: `sm-row${teaching ? ' teaching' : ''}`, testid: 'sound-class' },
      el('div', { className: 'sm-line' }, name, drum),
      el('div', { className: 'sm-line' }, el('span', { testid: 'sound-class-count', textContent: `${n} ${n === 1 ? 'tap' : 'taps'}` }), teach, clear, remove),
    );
    row.dataset.class = c.id;
    if (teaching) row.append(el('p', { className: 'sm-coach' }, 'Tap it now, the way you will play it: 6 to 10 taps, soft and hard, a moment apart. Press Done when you have.'));
    return row;
  };

  let drawn: { classes: unknown; teaching: string | null } | null = null;
  const render = (s: SoundMapperState) => {
    if (!drawn || drawn.classes !== s.map.classes || drawn.teaching !== s.teaching) {
      rows.replaceChildren(...s.map.classes.map((c) => rowFor(c, s.teaching === c.id)));
      drawn = { classes: s.map.classes, teaching: s.teaching };
    }
    const last = s.hits[0];
    for (const r of rows.children) (r as HTMLElement).classList.toggle('lit', s.playing && last?.classId === (r as HTMLElement).dataset.class);
    add.disabled = s.map.classes.length >= SOUND_MAPPER_LIMITS.classes;
    const taught = s.map.classes.some((c) => c.examples.length > 0);
    play.textContent = s.playing ? 'Stop' : 'Play';
    play.disabled = !taught && !s.playing;
    play.classList.toggle('on', s.playing);
    const said = describeInput(s.status);
    input.textContent = said ?? '';
    input.hidden = !(said && (s.playing || s.teaching));
    error.textContent = s.error ?? '';
    error.hidden = !s.error;
    hit.hidden = !s.playing;
    if (!last) {
      hit.removeAttribute('data-testid');
      hit.replaceChildren('Nothing heard yet.');
    } else {
      const label = last.classId === null ? 'Not one of yours' : (s.map.classes.find((c) => c.id === last.classId)?.label ?? 'Removed sound');
      hit.dataset.testid = 'sound-hit';
      hit.dataset.class = last.classId ?? '';
      const ms = el('span', { className: 'sm-ms', title: 'From the tap to the drum, inside the page (the microphone and speaker add their own)', textContent: `${last.latencyMs.toFixed(1)} ms` });
      ms.dataset.testid = 'sound-hit-ms';
      hit.replaceChildren(el('b', {}, label), ...(last.revised ? [el('span', { className: 'sm-revised' }, 'corrected')] : []), el('span', { className: 'sm-conf' }, `${Math.round(last.confidence * 100)}%`), ms);
    }
    for (const sl of sliders) sl.show(s.map[sl.key]);
  };
  render(store.getState());
  return store.subscribe(render);
}
