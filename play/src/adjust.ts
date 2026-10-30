/**
 * The Adjust panel: the knobs a player turns while practising (how big the targets are, how long a
 * hold takes, how smooth the dot is, how wide "in tune" is), as sliders under a page's controls.
 * A page names the knobs it has and what a move does; a move takes effect at once (a game in play
 * is retuned, not restarted), is kept in this browser per game, and is part of the game a player
 * saves (the spec bar reads the sliders by setting name, and opening a spec sets them).
 */
import type { GameId, GameSettings } from '@thoremin/games/spec';
import { TUNING_RANGES } from '@thoremin/games/tuning';
import { stored } from './stored';

export type KnobKey = keyof typeof TUNING_RANGES & keyof GameSettings;

export interface Knob {
  key: KnobKey;
  label: string;
  /** The page's default (the difficulty's, for a hold or a tolerance). */
  value: number;
  /** How the value reads beside its slider. */
  format?(v: number): string;
}

export interface AdjustPanel {
  /** The sliders by setting name, for the spec bar. */
  inputs: Partial<Record<KnobKey, HTMLInputElement>>;
  /** The values now. */
  values(): Partial<Record<KnobKey, number>>;
  /** Put a knob back to a new default (the difficulty changed) unless the player has moved it. */
  setDefault(key: KnobKey, value: number): void;
}

const FORMATS: Record<KnobKey, (v: number) => string> = {
  size: (v) => `${Math.round(v * 100)} %`,
  holdS: (v) => `${v.toFixed(2)} s`,
  smoothing: (v) => (v < 0.2 ? `${Math.round(v * 100)} (quick)` : v > 0.8 ? `${Math.round(v * 100)} (steady)` : String(Math.round(v * 100))),
  tolerance: (v) => `${Math.round(v)} cents`,
};

const isValues = (v: unknown): v is Partial<Record<KnobKey, number>> => !!v && typeof v === 'object' && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x));

export function mountAdjust(o: { game: GameId; host: HTMLElement; knobs: readonly Knob[]; onChange(values: Partial<Record<KnobKey, number>>): void }): AdjustPanel {
  const kept = stored(`funfon.adjust.${o.game}`, isValues);
  const moved = new Set(Object.keys(kept.read() ?? {}) as KnobKey[]);
  const panel = document.createElement('details');
  panel.className = 'adjust';
  const summary = document.createElement('summary');
  summary.textContent = 'Adjust';
  panel.append(summary);
  const inputs: Partial<Record<KnobKey, HTMLInputElement>> = {};
  const defaults: Partial<Record<KnobKey, number>> = {};
  const outputs: Partial<Record<KnobKey, HTMLOutputElement>> = {};

  const values = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, Number(el.value)])) as Partial<Record<KnobKey, number>>;
  const show = (k: KnobKey) => (outputs[k]!.value = (o.knobs.find((x) => x.key === k)?.format ?? FORMATS[k])(Number(inputs[k]!.value)));
  const keep = () => kept.write(Object.fromEntries([...moved].map((k) => [k, Number(inputs[k]!.value)])));

  for (const knob of o.knobs) {
    const range = TUNING_RANGES[knob.key];
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = knob.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    defaults[knob.key] = knob.value;
    input.value = String(kept.read()?.[knob.key] ?? knob.value);
    const out = document.createElement('output');
    row.append(name, input, out);
    panel.append(row);
    inputs[knob.key] = input;
    outputs[knob.key] = out;
    show(knob.key);
    // `input` while dragging, `change` when a spec sets it.
    const moveTo = () => {
      moved.add(knob.key);
      show(knob.key);
      keep();
      o.onChange(values());
    };
    input.addEventListener('input', moveTo);
    input.addEventListener('change', moveTo);
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset';
  reset.addEventListener('click', () => {
    moved.clear();
    kept.clear();
    for (const [k, el] of Object.entries(inputs) as [KnobKey, HTMLInputElement][]) {
      el.value = String(defaults[k]);
      show(k);
    }
    o.onChange(values());
  });
  panel.append(reset);
  o.host.append(panel);

  return {
    inputs,
    values,
    setDefault(key, value) {
      defaults[key] = value;
      if (moved.has(key) || !inputs[key]) return;
      inputs[key]!.value = String(value);
      show(key);
      o.onChange(values());
    },
  };
}
