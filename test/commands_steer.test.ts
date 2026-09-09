/**
 * The generative steering commands (#141 / #188 PR 5): every verb has scalar
 * params, reads the effective `steerConfig`, computes the next whole config and
 * writes it through the validated dial path — so the palette, the AI assistant and
 * the panel edit the strain / dial arrays that `dial.setIn` cannot reach. Identity is
 * the strain's text (a rename keeps the binding), a dial's name (one per knob); a
 * mismatched feature is refused rather than silently reading zero; the AI surface
 * sees only scalar parameter schemas.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createThoreminRegistry } from '@/app/commands/registry';
import { currentSteerConfig, STEER_COMMANDS } from '@/app/commands/steer';
import { dialsStore } from '@/app/dials/settingsStore';
import { useControls } from '@/app/store';
import { DEFAULT_STEER_CONFIG, defaultSteerConfig } from '@/settings/schema';

const reg = createThoreminRegistry();
const texts = () => currentSteerConfig().strains.map((s) => s.text);

beforeEach(() => {
  dialsStore.set('steerConfig', defaultSteerConfig());
});

describe('steer.strain.*', () => {
  it('starts from the complete default (the starter strains), never from an empty list', () => {
    expect(texts()).toEqual(DEFAULT_STEER_CONFIG.strains!.map((s) => s.text));
  });

  it('add appends a fully specified strain with the default binding, and lands in the hot store', async () => {
    const r = await reg.dispatch('steer.strain.add', { text: 'rain on glass' });
    expect(r.ok).toBe(true);
    const added = currentSteerConfig().strains.at(-1)!;
    expect(added).toEqual({ text: 'rain on glass', source: 'hand', hand: 'right', feature: 'openness', inMin: 0, inMax: 1, weightMin: 0, weightMax: 2 });
    // The dials → store sync carried it to what `store-controls` reads each tick.
    expect(useControls.getState().steer.config.strains?.at(-1)?.text).toBe('rain on glass');
  });

  it('add with a binding + invert + weightMax; a duplicate text is refused', async () => {
    await reg.dispatch('steer.strain.add', { text: 'choir', source: 'face', feature: 'smile', invert: true, weightMax: 1.5 });
    const s = currentSteerConfig().strains.find((x) => x.text === 'choir')!;
    expect(s).toMatchObject({ source: 'face', feature: 'smile', inMin: 1, inMax: 0, weightMax: 1.5 });
    const dup = await reg.dispatch('steer.strain.add', { text: 'choir' });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe('duplicate_strain');
  });

  it('refuses a feature that does not belong to the source (a face strain on openness)', async () => {
    const r = await reg.dispatch('steer.strain.add', { text: 'x', source: 'face', feature: 'openness' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('feature_source_mismatch');
    expect(texts()).not.toContain('x');
  });

  it('remove drops by text; an unknown text is an error, not a silent no-op', async () => {
    const ok = await reg.dispatch('steer.strain.remove', { text: 'warm ambient pads' });
    expect(ok.ok).toBe(true);
    expect(texts()).toEqual(['bright plucked arpeggios']);
    const missing = await reg.dispatch('steer.strain.remove', { text: 'nope' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('unknown_strain');
  });

  it('rename keeps the binding and the position; renaming onto an existing text is refused', async () => {
    await reg.dispatch('steer.strain.rename', { text: 'warm ambient pads', to: 'cold pads' });
    const cfg = currentSteerConfig();
    expect(cfg.strains[0]).toMatchObject({ text: 'cold pads', feature: 'openness', hand: 'right' });
    const clash = await reg.dispatch('steer.strain.rename', { text: 'cold pads', to: 'bright plucked arpeggios' });
    expect(clash.ok).toBe(false);
  });

  it('bind changes only the given fields; a source change without a fitting feature is refused', async () => {
    await reg.dispatch('steer.strain.bind', { text: 'warm ambient pads', hand: 'left', invert: true });
    expect(currentSteerConfig().strains[0]).toMatchObject({ hand: 'left', feature: 'openness', inMin: 1, inMax: 0 });
    const bad = await reg.dispatch('steer.strain.bind', { text: 'warm ambient pads', source: 'face' });
    expect(bad.ok).toBe(false);
    const good = await reg.dispatch('steer.strain.bind', { text: 'warm ambient pads', source: 'face', feature: 'browRaise' });
    expect(good.ok).toBe(true);
    expect(currentSteerConfig().strains[0]).toMatchObject({ source: 'face', feature: 'browRaise' });
  });

  it('range sets the weight span; the schema refuses an out-of-range value through the same path', async () => {
    await reg.dispatch('steer.strain.range', { text: 'warm ambient pads', weightMin: 0.5, weightMax: 3 });
    expect(currentSteerConfig().strains[0]).toMatchObject({ weightMin: 0.5, weightMax: 3 });
    const bad = await reg.dispatch('steer.strain.range', { text: 'warm ambient pads', weightMax: 99 });
    expect(bad.ok).toBe(false);
    expect(currentSteerConfig().strains[0].weightMax).toBe(3);
  });
});

describe('steer.dial.*', () => {
  it('set creates a binding with the knob’s natural range, then updates it in place', async () => {
    await reg.dispatch('steer.dial.set', { name: 'bpm', hand: 'left', feature: 'x' });
    let d = currentSteerConfig().dials.find((x) => x.name === 'bpm')!;
    expect(d).toMatchObject({ source: 'hand', hand: 'left', feature: 'x', outMin: 60, outMax: 200 });
    await reg.dispatch('steer.dial.set', { name: 'bpm', outMax: 140, invert: true });
    d = currentSteerConfig().dials.find((x) => x.name === 'bpm')!;
    expect(d).toMatchObject({ outMin: 60, outMax: 140, inMin: 1, inMax: 0, feature: 'x' });
    expect(currentSteerConfig().dials.filter((x) => x.name === 'bpm')).toHaveLength(1);
  });

  it('remove drops the binding; an unbound name is an error', async () => {
    const ok = await reg.dispatch('steer.dial.remove', { name: 'brightness' });
    expect(ok.ok).toBe(true);
    expect(currentSteerConfig().dials).toEqual([]);
    const missing = await reg.dispatch('steer.dial.remove', { name: 'density' });
    expect(missing.ok).toBe(false);
  });
});

describe('the command surface', () => {
  it('registers every steer verb, in the Generative category, with scalar-only params (no object or array param reaches a tool schema)', () => {
    for (const cmd of STEER_COMMANDS) {
      expect(reg.has(cmd.id)).toBe(true);
      expect(cmd.category).toBe('Generative');
      const shape = (cmd.params as unknown as { shape: Record<string, { _zod: { def: { type: string; innerType?: { _zod: { def: { type: string } } } } } }> }).shape;
      for (const [name, field] of Object.entries(shape)) {
        const t = field._zod.def.type === 'optional' ? field._zod.def.innerType!._zod.def.type : field._zod.def.type;
        expect(['string', 'number', 'boolean', 'enum'], `${cmd.id}.${name} is ${t}`).toContain(t);
      }
    }
  });
});
