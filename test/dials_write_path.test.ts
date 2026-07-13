/**
 * The panel write-path guard (#126) — the invariant that makes #87's "the registry is the
 * single write path" TRUE rather than aspirational.
 *
 * The rule, stated exactly:
 *
 *   In the settings panels, the ONLY control that may write the dials store directly is a
 *   `type="range"` slider being dragged. Every other control — a `<select>`, a `<Toggle>`,
 *   a checkbox, a mode `<button>` — must write by DISPATCHING a command.
 *
 * The slider exception is Decision B (see `docs/design/command-dispatch.md`): a live drag
 * fires a write per pointer-move frame, and routing that through Zod param validation, the
 * confirmation-gate wrapper and a promise buys nothing and costs latency on the one
 * interaction where latency is audible. It is a decision, not a gap — so the guard permits
 * it by NAME and refuses everything else, rather than being a soft "prefer dispatch" hint.
 *
 * thoremin ships no ESLint (it lints with `tsc --noEmit`), so — like the import firewall —
 * this boundary is enforced as a TEST. It is a real AST analysis, not a text grep: it
 * follows the local helper functions a handler calls (`patchLive`, `setRange`, …), so a
 * violation cannot hide one indirection away. A regex over `set(` could not do that, and a
 * regex over `<select` could not tell which handler belongs to which control.
 *
 * Scope: the DIALS setter (`useDialsSettings().set` / `setDial` / `dialsStore`). Reading
 * the hot `useControls` store, and writing NON-dial tooling state on it (the per-device
 * face calibration), stay legitimate — they are not param mutations.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** The settings-panel sources this rule governs: the composition root + every section. */
const PANEL_DIR = 'src/app/dials/panels';
const PANEL_FILES = [
  'src/app/dials/DialsControlsPanel.tsx',
  ...readdirSync(PANEL_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(PANEL_DIR, f)),
];

/** The names that, once bound in a panel, ARE a direct write into the dials store. */
const DIALS_WRITER_IMPORTS = new Set(['setDial', 'resetDial', 'dialsStore']);
/** The members of `useDialsSettings()` that write (as opposed to `state` / `form` / `states`). */
const DIALS_WRITER_MEMBERS = new Set(['set', 'reset']);

interface Violation {
  file: string;
  line: number;
  control: string;
  writer: string;
}

/** True when `node` sits inside any of the sanctioned source ranges. */
const inside = (node: ts.Node, ranges: Array<[number, number]>): boolean =>
  ranges.some(([start, end]) => node.getStart() >= start && node.getEnd() <= end);

/** An identifier in a PROPERTY position (`x.set`, `{ set: … }`, `onChange=`) names a member,
 *  not the local binding — skip it, or every `.set()` on an unrelated object would trip. */
function isPropertyPosition(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
  if (ts.isPropertyAssignment(p) && p.name === id) return true;
  if (ts.isJsxAttribute(p) && p.name === id) return true;
  if (ts.isBindingElement(p) && p.propertyName === id) return true;
  return false;
}

/** Every identifier REFERENCED (not declared, not a member name) in a subtree. */
function referencedIdentifiers(node: ts.Node): Set<string> {
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && !isPropertyPosition(n)) out.add(n.text);
    n.forEachChild(walk);
  };
  node.forEachChild(walk);
  return out;
}

/**
 * True when a function RENDERS — i.e. it is a component (or a render helper), not a write
 * helper. This distinction is what makes the guard work at all: a component's body
 * legitimately contains the writer reference (inside a slider handler), so if the component
 * were treated as "a function that calls the setter" its whole body would be sanctioned and
 * the rule would pass vacuously — which is exactly what a naive taint pass does. Only
 * JSX-FREE helpers (`patchLive`, `setRange`) are write helpers.
 */
function containsJsx(node: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    n.forEachChild(walk);
  };
  walk(node);
  return found;
}

/**
 * Analyze one panel source: find the identifiers that write the dials store (directly, or
 * through a local helper that does), then report every reference to one of them that is
 * NOT inside the sanctioned surface (the writer's own definition, the `useDialsSettings()`
 * destructure, an import, or a `type="range"` handler).
 *
 * Exported shape (file, line, control, writer) so a failure names the offending control.
 */
function writePathViolations(file: string, source: string): Violation[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const writers = new Set<string>();
  const localFns = new Map<string, ts.Node>(); // name → its declaration node
  const sanctioned: Array<[number, number]> = []; // source ranges a writer reference may live in
  const sliders: ts.Node[] = [];

  const collect = (n: ts.Node): void => {
    // `import { setDial } from '../settingsStore'` — a panel reaching past the hook.
    if (ts.isImportDeclaration(n)) {
      sanctioned.push([n.getStart(), n.getEnd()]);
      const named = n.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (DIALS_WRITER_IMPORTS.has(imported)) writers.add(el.name.text);
        }
      }
    }

    if (ts.isVariableDeclaration(n)) {
      // `const { state, set } = useDialsSettings()` — the hook's write members.
      if (
        ts.isObjectBindingPattern(n.name) &&
        n.initializer &&
        ts.isCallExpression(n.initializer) &&
        ts.isIdentifier(n.initializer.expression) &&
        n.initializer.expression.text === 'useDialsSettings'
      ) {
        sanctioned.push([n.getStart(), n.getEnd()]);
        for (const el of n.name.elements) {
          const member = (el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : null) ??
            (ts.isIdentifier(el.name) ? el.name.text : null);
          if (member && DIALS_WRITER_MEMBERS.has(member) && ts.isIdentifier(el.name)) writers.add(el.name.text);
        }
      }
      // `const patchLive = (p) => …` — a local WRITE helper a handler may call. A JSX-free
      // function only: a component/render helper also "calls the setter" (from its slider
      // handler), and sanctioning its body would sanctify the whole panel.
      if (
        ts.isIdentifier(n.name) &&
        n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) &&
        !containsJsx(n.initializer)
      ) {
        localFns.set(n.name.text, n);
      }
    }
    if (ts.isFunctionDeclaration(n) && n.name && !containsJsx(n)) localFns.set(n.name.text, n);

    // A `type="range"` input is the ONE sanctioned direct writer (Decision B).
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const tag = n.tagName.getText(sf);
      const typeAttr = n.attributes.properties.find(
        (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'type',
      );
      const typeValue = typeAttr?.initializer && ts.isStringLiteral(typeAttr.initializer) ? typeAttr.initializer.text : null;
      if (tag === 'input' && typeValue === 'range') sliders.push(n);
    }
    n.forEachChild(collect);
  };
  collect(sf);
  for (const s of sliders) sanctioned.push([s.getStart(), s.getEnd()]);

  // TAINT: a local helper that (transitively) calls a writer IS a writer. This is what makes
  // the guard hold one indirection away — `<select onChange={() => patchLive(…)}>` must fail
  // just as loudly as `<select onChange={() => set(…)}>`.
  const refs = new Map<string, Set<string>>();
  for (const [name, decl] of localFns) refs.set(name, referencedIdentifiers(decl));
  const tainted = new Set(writers);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, ids] of refs) {
      if (tainted.has(name)) continue;
      if ([...ids].some((i) => tainted.has(i))) {
        tainted.add(name);
        changed = true;
      }
    }
  }
  for (const name of tainted) {
    const decl = localFns.get(name);
    if (decl) sanctioned.push([decl.getStart(), decl.getEnd()]);
  }

  // Every reference to a tainted name outside the sanctioned surface is a direct write from
  // a control that should have dispatched.
  const violations: Violation[] = [];
  const check = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && tainted.has(n.text) && !isPropertyPosition(n) && !inside(n, sanctioned)) {
      violations.push({
        file,
        line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
        control: enclosingControl(n, sf),
        writer: n.text,
      });
    }
    n.forEachChild(check);
  };
  check(sf);
  return violations;
}

/** The JSX element a node sits inside (for a legible failure message). */
function enclosingControl(node: ts.Node, sf: ts.SourceFile): string {
  for (let p: ts.Node | undefined = node; p; p = p.parent) {
    if (ts.isJsxSelfClosingElement(p) || ts.isJsxOpeningElement(p)) return `<${p.tagName.getText(sf)}>`;
    if (ts.isSourceFile(p)) break;
  }
  return '(not in a JSX control)';
}

describe('settings-panel write path (#126)', () => {
  it('no DISCRETE panel control writes the dials store directly — they all dispatch', () => {
    const violations = PANEL_FILES.flatMap((f) => writePathViolations(f, readFileSync(f, 'utf8')));
    expect(
      violations,
      violations
        .map(
          (v) =>
            `${v.file}:${v.line} — ${v.control} reaches the direct dials setter "${v.writer}". ` +
            'A discrete control must dispatch (dispatchDialSet / dispatchDialSetIn / dispatchDialPatch); ' +
            'only a type="range" slider may write directly (Decision B).',
        )
        .join('\n'),
    ).toEqual([]);
  });

  it('guard the guard: the analysis actually SEES the panels, their sliders and their setters', () => {
    // Without this, a parse failure (or a renamed directory) would make the rule above pass
    // vacuously — the classic way a firewall test rots into decoration.
    expect(PANEL_FILES.length).toBeGreaterThanOrEqual(7); // the root + 6 sections
    const sources = PANEL_FILES.map((f) => readFileSync(f, 'utf8'));
    expect(sources.filter((s) => /type="range"/.test(s)).length).toBeGreaterThanOrEqual(5);
    // The sanctioned direct writers still EXIST (the sliders kept their fast path) — if the
    // sweep had simply deleted every `set`, the rule above would hold for the wrong reason.
    expect(sources.filter((s) => /useDialsSettings\(\)/.test(s) && /\bset\b/.test(s)).length).toBeGreaterThanOrEqual(5);
    // ...and the panels really do dispatch.
    expect(sources.filter((s) => /dispatchDial(Set|SetIn|Patch)/.test(s)).length).toBeGreaterThanOrEqual(5);
  });

  it('the analysis FLAGS a direct write from a <select> (the exact regression it exists to stop)', () => {
    const offending = `
      import { useDialsSettings } from '../useDialsSettings';
      export function Panel() {
        const { state, set } = useDialsSettings();
        return (
          <select value={state.effective['right.sound']} onChange={(e) => set('right.sound', e.target.value)}>
            <option value="glass">Glass</option>
          </select>
        );
      }`;
    const found = writePathViolations('synthetic.tsx', offending);
    expect(found.length).toBe(1);
    expect(found[0].control).toBe('<select>');
    expect(found[0].writer).toBe('set');
  });

  it('the analysis follows a HELPER — a direct write hidden one indirection away still fails', () => {
    const offending = `
      import { useDialsSettings } from '../useDialsSettings';
      export function Panel() {
        const { state, set } = useDialsSettings();
        const patch = (p) => set('overlay', { ...state.effective['overlay'], ...p });
        return <Toggle checked onChange={(v) => patch({ show: v })} />;
      }`;
    const found = writePathViolations('synthetic.tsx', offending);
    expect(found.length).toBe(1);
    expect(found[0].control).toBe('<Toggle>');
    expect(found[0].writer).toBe('patch'); // the helper is tainted BY the setter it calls
  });

  it('the analysis ALLOWS a slider (Decision B) — including through a helper', () => {
    const allowed = `
      import { useDialsSettings } from '../useDialsSettings';
      import { dispatchDialSet } from '../../dispatchDial';
      export function Panel() {
        const { state, set } = useDialsSettings();
        const setLive = (v) => set('master.volume', v);
        return (
          <>
            <input type="range" min={0} max={1} onChange={(e) => setLive(Number(e.target.value))} />
            <input type="range" min={0} max={1} onChange={(e) => set('faceChord.volume', Number(e.target.value))} />
            <select onChange={(e) => dispatchDialSet('right.sound', e.target.value)} />
          </>
        );
      }`;
    expect(writePathViolations('synthetic.tsx', allowed)).toEqual([]);
  });

  it('the analysis flags a panel that reaches PAST the hook to `setDial` itself', () => {
    // The obvious workaround, closed: importing the store's writer directly is still a
    // direct write, whatever the control calls it.
    const offending = `
      import { setDial } from '../settingsStore';
      export function Panel() {
        return <button onClick={() => setDial('face.mapping', 'chord')}>Chord</button>;
      }`;
    const found = writePathViolations('synthetic.tsx', offending);
    expect(found.length).toBe(1);
    expect(found[0].control).toBe('<button>');
    expect(found[0].writer).toBe('setDial');
  });
});
