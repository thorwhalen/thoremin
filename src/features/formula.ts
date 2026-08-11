/**
 * Safe formula compiler for the lab's derived features (#119).
 *
 * Parses a formula with `jsep` (a tiny parse-ONLY expression AST, MIT) and
 * compiles it to a closure by recursive descent over the AST. There is NO
 * `eval`, NO `new Function`, and NO member access: the compiler REJECTS
 * `MemberExpression` (both `a.b` and `a[b]`), calls to anything but a whitelisted
 * host helper, and any unknown variable — the security-critical requirement from
 * the #119 appendix (which rules out `expr-eval` for CVE-2025-12735 RCE and
 * `expression-eval` as an insecure sandbox). The only values a formula can reach
 * are the bound feature variables and the fixed helper functions.
 *
 * Invalid formulas fail at COMPILE time with a clear {@link FormulaError}; the
 * compiled closure never throws in the per-frame loop — a missing variable or a
 * divide-by-zero yields `NaN`/`Infinity`, which the caller drops (a non-finite
 * derived feature is simply not shown/recorded), so it can never reach audio.
 */
import jsep from 'jsep';
import ternary from '@jsep-plugin/ternary';
import { clamp01 } from './math';

// Ternary (`a ? b : c`) is not in jsep core; register the plugin once. Also lock
// the operator set down to arithmetic/comparison/logical (drop jsep's defaults we
// don't want, so a formula can't smuggle in an unexpected operator).
let registered = false;
function ensureJsep(): void {
  if (registered) return;
  jsep.plugins.register(ternary as unknown as Parameters<typeof jsep.plugins.register>[0]);
  registered = true;
}

/** Thrown at compile time for a syntactically or semantically invalid formula. */
export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

/** A numeric helper function callable from a formula. */
export type HelperFn = (...args: number[]) => number;

/** The fixed, safe helper set injected into every formula. */
export const DEFAULT_HELPERS: Readonly<Record<string, HelperFn>> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  sign: Math.sign,
  floor: Math.floor,
  round: Math.round,
  ceil: Math.ceil,
  exp: Math.exp,
  log: Math.log,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  tanh: Math.tanh,
  atan: Math.atan,
  min: (...a: number[]) => Math.min(...a),
  max: (...a: number[]) => Math.max(...a),
  pow: (a: number, b: number) => Math.pow(a, b),
  clamp: (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
  /** Map x from [lo, hi] to [0, 1], clamped (NaN if the range is degenerate). */
  norm: (x: number, lo: number, hi: number) => (Math.abs(hi - lo) < 1e-9 ? NaN : clamp01((x - lo) / (hi - lo))),
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  smoothstep: (e0: number, e1: number, x: number) => {
    if (Math.abs(e1 - e0) < 1e-9) return NaN;
    const t = clamp01((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  },
  /** Zero out |x| <= dz, pass through otherwise (a joystick deadzone). */
  deadzone: (x: number, dz: number) => (Math.abs(x) <= dz ? 0 : x),
};

/**
 * A factory producing a fresh helper closure PER FORMULA CALL SITE — for helpers
 * that carry state across frames (the #131 rolling regressions). Instantiated
 * once during compilation for each call expression, so two `residual(...)` calls
 * in one formula never share state, and a re-compile (config edit) starts clean.
 * `arity` is the call site's argument count — validate it here so a wrong-shaped
 * call fails at COMPILE time with a clear message, like every other formula error.
 */
export type StatefulHelperFactory = (arity: number) => HelperFn;

/** Default EW window (frames) for the deconfounding regressions: ~6 s at 30fps,
 *  matching the online normalizer's drift time constant. */
const DEFAULT_REGRESSION_WINDOW = 180;

/**
 * One exponentially-weighted linear regression of x on z (O(1) per frame):
 * returns `x - beta * (z - mean_z)` — x with z's linear component regressed out,
 * still in x's units. Until the regression warms up beta is 0, so the output
 * starts as plain x and sharpens as evidence accrues (never NaN-blocked at the
 * start). Non-finite inputs return NaN WITHOUT updating the state, so one bad
 * frame can't poison the running moments.
 */
function makeEwRegression(): (x: number, z: number, window?: number) => number {
  let mx = 0;
  let mz = 0;
  let cxz = 0;
  let vz = 0;
  let seeded = false;
  return (x, z, window = DEFAULT_REGRESSION_WINDOW) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return NaN;
    if (!seeded) {
      mx = x;
      mz = z;
      seeded = true;
      return x; // beta is 0 with one sample
    }
    const a = 1 / Math.max(2, window);
    const dx = x - mx; // deltas vs the PRE-update means (West-style EW moments)
    const dz = z - mz;
    mx += a * dx;
    mz += a * dz;
    cxz = (1 - a) * (cxz + a * dx * dz);
    vz = (1 - a) * (vz + a * dz * dz);
    const beta = vz > 1e-12 ? cxz / vz : 0;
    return x - beta * (z - mz);
  };
}

/**
 * The stateful helper set (#131): per-call-site rolling regressions for
 * correcting a confounded feature (see FeatureDef.invariantTo).
 *
 * - `residual(x, z[, window])` — x with z's linear component regressed out over
 *   an EW window (frames, default 180 ≈ 6 s at 30fps). E.g. a pose-corrected
 *   smile: `residual(face_geom_mouth_smileWidth, face_head_yaw)`.
 * - `deconfound(x, z1[, z2, ...])` — sequential residualization against several
 *   confounds (each with its own regression state); equivalent to nesting
 *   `residual(residual(x, z1), z2)` with the default window.
 */
export const STATEFUL_HELPERS: Readonly<Record<string, StatefulHelperFactory>> = {
  residual: (arity) => {
    if (arity < 2 || arity > 3) throw new FormulaError('residual(x, z[, window]) takes 2 or 3 arguments.');
    const reg = makeEwRegression();
    return (x: number, z: number, window?: number) => reg(x, z, window);
  },
  deconfound: (arity) => {
    if (arity < 2) throw new FormulaError('deconfound(x, z1[, z2, ...]) needs at least one confound.');
    const regs = Array.from({ length: arity - 1 }, makeEwRegression);
    return (...args: number[]) => {
      let r = args[0];
      for (let i = 1; i < args.length; i++) r = regs[i - 1](r, args[i]);
      return r;
    };
  },
};

/** The whitelisted binary operators (comparisons return 1/0 so they compose). */
const BINARY: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
  '**': (a, b) => a ** b,
  '==': (a, b) => (a === b ? 1 : 0),
  '!=': (a, b) => (a !== b ? 1 : 0),
  '===': (a, b) => (a === b ? 1 : 0),
  '!==': (a, b) => (a !== b ? 1 : 0),
  '<': (a, b) => (a < b ? 1 : 0),
  '<=': (a, b) => (a <= b ? 1 : 0),
  '>': (a, b) => (a > b ? 1 : 0),
  '>=': (a, b) => (a >= b ? 1 : 0),
};

type Scope = Record<string, number>;
type Thunk = (scope: Scope) => number;

/** A compiled, safe formula. `eval` never throws; unavailable variables → NaN. */
export interface CompiledFormula {
  source: string;
  /** The bound variable names the formula references (for dependency display). */
  variables: string[];
  eval(scope: Scope): number;
}

export interface CompileOptions {
  /** The allowed variable names (e.g. feature safe-names). Referencing anything
   *  else is a compile error (typo protection + no free identifiers). */
  variables: ReadonlySet<string>;
  /** The callable helper set (defaults to {@link DEFAULT_HELPERS}). */
  helpers?: Readonly<Record<string, HelperFn>>;
  /** Per-call-site stateful helper factories (defaults to {@link STATEFUL_HELPERS}). */
  statefulHelpers?: Readonly<Record<string, StatefulHelperFactory>>;
}

// Minimal structural types over the jsep AST nodes we accept.
interface Node {
  type: string;
  [k: string]: unknown;
}

/**
 * Compile `source` to a {@link CompiledFormula}. Throws {@link FormulaError} on a
 * parse error, a disallowed node (member access, assignment, ...), a call to a
 * non-helper, or a reference to an unknown variable.
 */
export function compileFormula(source: string, opts: CompileOptions): CompiledFormula {
  ensureJsep();
  const helpers = opts.helpers ?? DEFAULT_HELPERS;
  const statefulHelpers = opts.statefulHelpers ?? STATEFUL_HELPERS;
  const allHelperNames = () => [...Object.keys(helpers), ...Object.keys(statefulHelpers)].join(', ');
  const used = new Set<string>();

  let ast: Node;
  try {
    ast = jsep(source) as unknown as Node;
  } catch (e) {
    throw new FormulaError(`Parse error: ${(e as Error).message}`);
  }

  const walk = (node: Node): Thunk => {
    switch (node.type) {
      case 'Literal': {
        const v = typeof node.value === 'number' ? node.value : Number(node.value);
        if (!Number.isFinite(v)) throw new FormulaError(`Only numeric literals are allowed (got ${JSON.stringify(node.value)})`);
        return () => v;
      }
      case 'Identifier': {
        const name = node.name as string;
        if (!opts.variables.has(name)) {
          throw new FormulaError(`Unknown variable "${name}". Available: feature names + helpers (${allHelperNames()}).`);
        }
        used.add(name);
        // Absent this frame → NaN (dropped downstream), never a throw.
        return (scope) => {
          const v = scope[name];
          return typeof v === 'number' ? v : NaN;
        };
      }
      case 'UnaryExpression': {
        const arg = walk(node.argument as Node);
        const op = node.operator as string;
        if (op === '-') return (s) => -arg(s);
        if (op === '+') return (s) => +arg(s);
        if (op === '!') return (s) => (arg(s) ? 0 : 1);
        throw new FormulaError(`Unsupported unary operator "${op}"`);
      }
      case 'BinaryExpression': {
        const op = node.operator as string;
        const left = walk(node.left as Node);
        const right = walk(node.right as Node);
        // Short-circuit the logical operators (so `x!=0 && 1/x` doesn't force 1/0).
        if (op === '&&') return (s) => (left(s) ? right(s) : 0);
        if (op === '||') return (s) => { const l = left(s); return l ? l : right(s); };
        const fn = BINARY[op];
        if (!fn) throw new FormulaError(`Unsupported operator "${op}"`);
        return (s) => fn(left(s), right(s));
      }
      case 'ConditionalExpression': {
        const test = walk(node.test as Node);
        const consequent = walk(node.consequent as Node);
        const alternate = walk(node.alternate as Node);
        // Short-circuit: only the taken branch is evaluated.
        return (s) => (test(s) ? consequent(s) : alternate(s));
      }
      case 'CallExpression': {
        const callee = node.callee as Node;
        if (callee.type !== 'Identifier') throw new FormulaError('Only direct calls to named helper functions are allowed.');
        const name = callee.name as string;
        const argNodes = node.arguments as Node[];
        // Own-property checks only — a bare `helpers[name]` would resolve INHERITED
        // Object.prototype members (`constructor`, `hasOwnProperty`, `valueOf`, ...),
        // which both bypasses the whitelist (reaching a global constructor) and, for
        // the `this`-less prototype methods, throws at eval time, breaking the
        // never-throws contract. Reject any non-own key at compile time.
        if (Object.prototype.hasOwnProperty.call(statefulHelpers, name)) {
          // Stateful helper (#131): instantiate a FRESH closure for THIS call
          // site, so state (the rolling regression moments) is per-site and
          // resets on re-compile. Arity errors surface here, at compile time.
          const fn = statefulHelpers[name](argNodes.length);
          const args = argNodes.map((a) => walk(a));
          return (s) => fn(...args.map((a) => a(s)));
        }
        if (!Object.prototype.hasOwnProperty.call(helpers, name)) {
          throw new FormulaError(`Unknown function "${name}". Allowed: ${allHelperNames()}.`);
        }
        const fn = helpers[name];
        const args = argNodes.map((a) => walk(a));
        return (s) => fn(...args.map((a) => a(s)));
      }
      case 'MemberExpression':
        throw new FormulaError('Member access (a.b / a[b]) is not allowed.');
      case 'ArrayExpression':
        throw new FormulaError('Array literals are not allowed.');
      case 'Compound':
        throw new FormulaError('A formula must be a single expression (no commas / statements).');
      default:
        throw new FormulaError(`Unsupported expression: ${node.type}`);
    }
  };

  const thunk = walk(ast);
  return {
    source,
    variables: [...used],
    eval: (scope: Scope) => thunk(scope),
  };
}
