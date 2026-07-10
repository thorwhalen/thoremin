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
