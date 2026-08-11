/**
 * Safe formula compiler tests (#119). The SECURITY half is load-bearing: the
 * compiler must reject member access, calls to non-helpers, and free identifiers,
 * so a derived-feature formula can never reach `constructor`/`__proto__`/globals
 * (the class of bug that makes `expr-eval` an RCE). The CORRECTNESS half checks
 * arithmetic, helpers, ternary short-circuiting, and the runtime NaN contract.
 */
import { describe, it, expect } from 'vitest';
import { compileFormula, FormulaError, DEFAULT_HELPERS } from '@/features/formula';

const VARS = new Set(['x', 'y', 'face_geom_mouth_openness']);
const compile = (src: string) => compileFormula(src, { variables: VARS });

describe('formula compiler — security', () => {
  it('rejects member access (dotted and computed)', () => {
    expect(() => compile('x.constructor')).toThrow(FormulaError);
    expect(() => compile('x["a"]')).toThrow(FormulaError);
    expect(() => compile('x.__proto__')).toThrow(FormulaError);
  });

  it('rejects calls to anything but a whitelisted helper', () => {
    expect(() => compile('constructor("return 1")')).toThrow(FormulaError);
    expect(() => compile('alert(1)')).toThrow(FormulaError);
    expect(() => compile('eval("1")')).toThrow(FormulaError);
  });

  it('rejects calls to INHERITED Object.prototype members (no prototype-chain bypass)', () => {
    // `helpers[name]` would otherwise resolve these to real functions: `constructor`
    // reaches the global Object constructor (a whitelist bypass), and the this-less
    // prototype methods would throw at eval time (breaking the never-throws contract).
    for (const src of ['constructor(0)', 'hasOwnProperty(1)', 'valueOf()', 'toString(1)', 'isPrototypeOf(1)', 'propertyIsEnumerable(1)', '__defineGetter__(1, 2)']) {
      expect(() => compile(src), src).toThrow(FormulaError);
    }
  });

  it('rejects unknown / free identifiers (no globals, typo protection)', () => {
    expect(() => compile('window')).toThrow(FormulaError);
    expect(() => compile('globalThis')).toThrow(FormulaError);
    expect(() => compile('__proto__')).toThrow(FormulaError);
    expect(() => compile('x + notAFeature')).toThrow(FormulaError);
  });

  it('rejects statements / multiple expressions / arrays', () => {
    expect(() => compile('x; y')).toThrow(FormulaError);
    expect(() => compile('[x, y]')).toThrow(FormulaError);
    expect(() => compile('')).toThrow(FormulaError);
  });
});

describe('formula compiler — correctness', () => {
  it('evaluates arithmetic with correct precedence', () => {
    expect(compile('x + y * 2').eval({ x: 1, y: 3 })).toBe(7);
    expect(compile('(x + y) * 2').eval({ x: 1, y: 3 })).toBe(8);
    expect(compile('-x').eval({ x: 5 })).toBe(-5);
    expect(compile('x % 3').eval({ x: 7 })).toBe(1);
    expect(compile('2 ** 3').eval({})).toBe(8);
  });

  it('supports the whitelisted helpers', () => {
    expect(compile('clamp(x, 0, 1)').eval({ x: 2 })).toBe(1);
    expect(compile('clamp(x, 0, 1)').eval({ x: -2 })).toBe(0);
    expect(compile('norm(x, 0, 10)').eval({ x: 5 })).toBe(0.5);
    expect(compile('min(x, y)').eval({ x: 3, y: 7 })).toBe(3);
    expect(compile('max(x, y, 9)').eval({ x: 3, y: 7 })).toBe(9);
    expect(compile('abs(x)').eval({ x: -4 })).toBe(4);
    expect(compile('lerp(0, 10, x)').eval({ x: 0.25 })).toBe(2.5);
    expect(compile('deadzone(x, 0.1)').eval({ x: 0.05 })).toBe(0);
    expect(compile('deadzone(x, 0.1)').eval({ x: 0.5 })).toBe(0.5);
  });

  it('supports comparisons (1/0), logical ops, and ternary short-circuit', () => {
    expect(compile('x > 0.5').eval({ x: 0.7 })).toBe(1);
    expect(compile('x > 0.5').eval({ x: 0.3 })).toBe(0);
    expect(compile('x > 0 && y > 0').eval({ x: 1, y: 1 })).toBe(1);
    expect(compile('x > 0 && y > 0').eval({ x: 1, y: -1 })).toBe(0);
    // Ternary short-circuits: the untaken 1/x branch is never evaluated at x=0.
    expect(compile('x != 0 ? 1 / x : 0').eval({ x: 0 })).toBe(0);
    expect(compile('x != 0 ? 1 / x : 0').eval({ x: 2 })).toBe(0.5);
  });

  it('reports the variables it references', () => {
    const f = compile('x + face_geom_mouth_openness');
    expect(new Set(f.variables)).toEqual(new Set(['x', 'face_geom_mouth_openness']));
  });
});

describe('formula compiler — runtime contract (never throws in the loop)', () => {
  it('an absent variable yields NaN, not a throw', () => {
    const f = compile('x + y');
    expect(Number.isNaN(f.eval({ x: 1 }))).toBe(true); // y missing this frame
  });

  it('divide-by-zero yields a non-finite value the caller drops', () => {
    const f = compile('1 / x');
    expect(Number.isFinite(f.eval({ x: 0 }))).toBe(false);
  });

  it('the helper set is the documented, fixed list', () => {
    for (const name of ['abs', 'min', 'max', 'clamp', 'sqrt', 'pow', 'log', 'exp', 'sin', 'cos', 'tanh', 'sign', 'norm', 'lerp', 'smoothstep', 'deadzone']) {
      expect(typeof DEFAULT_HELPERS[name]).toBe('function');
    }
  });
});

describe('stateful helpers — residual / deconfound (#131)', () => {
  const VARS = new Set(['x', 'z', 'z2']);

  it('residual regresses out a perfectly linear confound (over the EW window)', () => {
    // x = 2*z, noiseless, with the confound varying much FASTER than the EW
    // window (period ~19 frames vs window 120), so the regression sees many
    // cycles and beta converges. Assert the reduction RATIO over the last
    // stretch: most of the linear component must be gone.
    const f = compileFormula('residual(x, z, 120)', { variables: VARS });
    let rssRes = 0;
    let rssRaw = 0;
    for (let i = 0; i < 900; i++) {
      const z = Math.sin(i / 3);
      const out = f.eval({ x: 2 * z, z });
      if (i >= 840) {
        rssRes += out * out;
        rssRaw += (2 * z) * (2 * z);
      }
    }
    expect(Math.sqrt(rssRes / rssRaw)).toBeLessThan(0.25); // >75% of the swing removed
  });

  it('residual leaves an INDEPENDENT signal essentially alone', () => {
    const f = compileFormula('residual(x, z, 30)', { variables: VARS });
    let out = 0;
    for (let i = 0; i < 600; i++) {
      out = f.eval({ x: Math.sin(i / 7), z: Math.cos(i / 13) }); // uncorrelated-ish
    }
    // The independent signal keeps most of its swing (beta stays small).
    expect(Math.abs(out - Math.sin(599 / 7))).toBeLessThan(0.4);
  });

  it('two residual call sites in ONE formula keep separate state', () => {
    const f = compileFormula('residual(x, z, 10) - residual(x, z2, 10)', { variables: VARS });
    // If the two call sites shared state, feeding them different confounds would
    // corrupt each other; a same-inputs eval must be exactly 0 either way, and a
    // different-confounds sequence must produce a finite, non-NaN difference.
    let out = NaN;
    for (let i = 0; i < 100; i++) {
      out = f.eval({ x: Math.sin(i / 5), z: Math.sin(i / 5), z2: Math.cos(i / 5) });
    }
    expect(Number.isFinite(out)).toBe(true);
    // x == z exactly, so the first residual is ~0; the second keeps most of x.
    expect(Math.abs(out)).toBeGreaterThan(0.05);
  });

  it('deconfound(x, z1, z2) ~ residual(residual(x, z1), z2)', () => {
    const a = compileFormula('deconfound(x, z, z2)', { variables: VARS });
    const b = compileFormula('residual(residual(x, z), z2)', { variables: VARS });
    let va = 0;
    let vb = 0;
    for (let i = 0; i < 300; i++) {
      const scope = { x: Math.sin(i / 9) + 0.5 * Math.cos(i / 4), z: Math.cos(i / 4), z2: Math.sin(i / 6) };
      va = a.eval(scope);
      vb = b.eval(scope);
    }
    expect(va).toBeCloseTo(vb, 10);
  });

  it('non-finite inputs return NaN without poisoning the regression state', () => {
    // Twin instances fed identical good frames; one also receives a NaN frame.
    // If the NaN mutated any state, the next outputs would diverge.
    const a = compileFormula('residual(x, z, 20)', { variables: VARS });
    const b = compileFormula('residual(x, z, 20)', { variables: VARS });
    for (let i = 0; i < 100; i++) {
      const scope = { x: 2 * Math.sin(i / 10), z: Math.sin(i / 10) };
      a.eval(scope);
      b.eval(scope);
    }
    expect(Number.isNaN(a.eval({ x: NaN, z: 1 }))).toBe(true); // only A sees the bad frame
    const scope = { x: 2 * Math.sin(100 / 10), z: Math.sin(100 / 10) };
    expect(a.eval(scope)).toBe(b.eval(scope)); // ...and it changed nothing
  });

  it('arity errors surface at COMPILE time with clear messages', () => {
    expect(() => compileFormula('residual(x)', { variables: VARS })).toThrow(/residual\(x, z\[, window\]\)/);
    expect(() => compileFormula('deconfound(x)', { variables: VARS })).toThrow(/deconfound/);
  });

  it('a fresh compile starts from clean state (config edits reset the regressions)', () => {
    const warm = compileFormula('residual(x, z, 10)', { variables: VARS });
    for (let i = 0; i < 200; i++) warm.eval({ x: 2 * Math.sin(i / 10), z: Math.sin(i / 10) });
    const fresh = compileFormula('residual(x, z, 10)', { variables: VARS });
    // First eval of a fresh instance returns plain x (beta 0), regardless of
    // what any other instance has learned.
    expect(fresh.eval({ x: 1.5, z: 0.75 })).toBe(1.5);
  });
});
