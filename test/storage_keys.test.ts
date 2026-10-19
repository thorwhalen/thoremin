/**
 * The storage-key registry (#600 S12): every key the shipped code keeps in the browser is listed,
 * with its owner, and nothing listed is stale. Core's keys are `src/host/storageKeys.ts`; an
 * extension's are its declared stores (`Extension.stores`), folded by the contribution registry.
 *
 * The check is a static scan, as the other boundaries here are (the repo lints with `tsc`, so a
 * rule is a test). A key candidate is a string literal that looks like one of the app's keys
 * (`thoremin-…`, `thoremin.…`, `thoremin:…`, `taglog.…`, `recording.…`; a window debug handle such as `thoremin` is not one), found either anywhere in a file that touches browser
 * storage, or as the value of a constant named like a key (`…_KEY`, `DB_NAME`) anywhere. A template
 * literal contributes its constant start (`thoremin:plugin:assistant:apiKey:${provider}`), which a
 * prefix entry covers. In an extension's directory, any literal handed to `localStorage.*Item` or
 * `indexedDB.open` counts too, whatever it looks like. Core's directories are checked against
 * core's list; each extension's directory against its own declared stores, while it is listed.
 *
 * The declarations themselves are not scanned (the registry, and each extension's `stores.ts`):
 * a key is "kept" only when code keeps it, so a key whose writer is gone is reported as stale. A
 * declared store counts as used when code reads it by property (`AIR_STORES.padLayouts`).
 *
 * The frozen legacy app is out of scope (its keys are its own, and it gets no changes).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EXTENSIONS } from '@/extensions';
import { CONTRIBUTIONS, foldContributions } from '@/host/contributions';
import { CORE_STORAGE_KEYS, type StorageKeyEntry } from '@/host/storageKeys';
import type { Extension } from '@thoremin/sdk/instruments/extension';
import { SHIPPED_EXTENSION_DIRS } from './helpers/extensions';

const ROOT = join(__dirname, '..');

/** Core's source: the shell and the packages core ships (not the extensions). */
const CORE_DIRS = ['src', 'packages/sdk/src', 'packages/sdk-ui/src', 'packages/taglog/src', 'packages/dag/src', 'packages/ictus/src', 'packages/lazy/src', 'packages/stats/src'];

/** The frozen legacy app (`?engine=legacy`), which keeps its own keys and gets no changes. */
const LEGACY = [/^src\/App\.tsx$/, /^src\/components\//, /^src\/hooks\//, /^src\/plugins\/ai-dj\//, /^src\/plugins\/PluginProvider\.tsx$/];

/** A file that touches browser storage. */
const STORAGE_API = /\blocalStorage\b|\bindexedDB\b|\bpersist\(|createJSONStorage|createLocalStorageProvider|localStorageCollectionProvider|createNamedCollectionStore|createLocalStorageProfileStorage|localStorageFlag|createIdbProvider|useLocalStorage|hostCollection\(|storage\(\)/;
/** What the app's keys look like. */
const KEY_LIKE = /^(thoremin[-.:]|taglog\.|recording\.)/;
/** The declarations: the registry and each extension's `stores.ts`. */
const isDeclaration = (rel: string): boolean => rel === 'src/host/storageKeys.ts' || /(^|\/)src\/stores\.ts$/.test(rel);
/** A literal handed straight to browser storage, whatever it looks like. */
const RAW_STORAGE = /(?:localStorage\.(?:get|set|remove)Item|indexedDB\.open)\(\s*(['"])([^'"]+)\1/g;
/** A constant named like a storage key. */
const KEY_CONST = /\b(?:const|let)\s+\w*(?:KEY|Key|DB_NAME|DB)\s*(?::\s*[\w.<>[\]|' ]+)?=\s*(['"])([^'"]+)\1/g;

function sourceFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** The key candidates in one file's text (`raw`: any literal handed to storage counts too). */
export function keyCandidates(text: string, raw = false): string[] {
  const found = new Set<string>();
  if (raw) for (const m of text.matchAll(RAW_STORAGE)) found.add(m[2]);
  for (const m of text.matchAll(KEY_CONST)) if (KEY_LIKE.test(m[2])) found.add(m[2]);
  if (STORAGE_API.test(text)) {
    for (const m of text.matchAll(/(['"])((?:(?!\1)[^\\\n])+)\1/g)) if (KEY_LIKE.test(m[2])) found.add(m[2]);
    for (const m of text.matchAll(/`([^`$]*)\$\{/g)) if (KEY_LIKE.test(m[1])) found.add(m[1]);
  }
  return [...found];
}

/** Every key candidate under `dirs` (the declarations left out), with where it was found. */
function candidatesIn(dirs: readonly string[], raw = false): Map<string, string> {
  const at = new Map<string, string>();
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      const rel = relative(ROOT, join(ROOT, file));
      if (LEGACY.some((re) => re.test(rel)) || isDeclaration(rel)) continue;
      for (const k of keyCandidates(readFileSync(join(ROOT, file), 'utf8'), raw)) if (!at.has(k)) at.set(k, rel);
    }
  }
  return at;
}

/** The declared stores an extension's code reads by property (`<STORES>.<prop>`), as their keys. */
function storesReadIn(dir: string): Set<string> {
  const decl = join(dir, 'stores.ts');
  if (!existsSync(join(ROOT, decl))) return new Set();
  const props = [...readFileSync(join(ROOT, decl), 'utf8').matchAll(/(\w+):\s*\{[^}]*legacyKey:\s*'([^']+)'/g)].map((m) => ({ prop: m[1], key: m[2] }));
  const code = sourceFiles(dir)
    .filter((f) => !isDeclaration(relative(ROOT, join(ROOT, f))))
    .map((f) => readFileSync(join(ROOT, f), 'utf8'))
    .join('\n');
  return new Set(props.filter(({ prop }) => new RegExp(`\\.${prop}\\b`).test(code)).map(({ key }) => key));
}

const covers = (entry: StorageKeyEntry, candidate: string): boolean => (entry.prefix ? candidate.startsWith(entry.key) : candidate === entry.key);
const listed = (entries: readonly StorageKeyEntry[], candidate: string): boolean => entries.some((e) => covers(e, candidate));

describe('the storage-key registry (#600 S12)', () => {
  it('core: every key core\'s code keeps is listed, and every listed key is still kept', () => {
    const found = candidatesIn(CORE_DIRS);
    // Guard the scan: it sees the tree (about 35 keys today).
    expect(found.size).toBeGreaterThan(25);
    const unlisted = [...found].filter(([k]) => !listed(CORE_STORAGE_KEYS, k)).map(([k, file]) => `${k} (${file})`);
    expect(unlisted, 'list each in src/host/storageKeys.ts with its owner').toEqual([]);
    const stale = CORE_STORAGE_KEYS.filter((e) => ![...found.keys()].some((k) => covers(e, k))).map((e) => e.key);
    expect(stale, 'listed in src/host/storageKeys.ts but no longer in the code').toEqual([]);
  });

  for (const { id, dir } of SHIPPED_EXTENSION_DIRS) {
    const ext = EXTENSIONS.find((e) => e.id === id) as Extension | undefined;
    it.runIf(ext !== undefined)(`the "${id}" extension: every key its code keeps is a store it declares, and every declared store is kept`, () => {
      const declared: StorageKeyEntry[] = (ext!.stores ?? []).map((s) => ({ key: s.legacyKey, kind: s.kind === 'database' ? 'indexedDB' : 'localStorage', owner: id, purpose: s.description }));
      const found = candidatesIn([dir], true);
      // A key the SDK's app half owns may be read by name (the faces' orphan sweep reads the
      // categorizers' collections): core's list covers it.
      const unlisted = [...found].filter(([k]) => !listed(declared, k) && !listed(CORE_STORAGE_KEYS, k)).map(([k, file]) => `${k} (${file})`);
      expect(unlisted, `declare each in the "${id}" manifest's stores`).toEqual([]);
      const read = storesReadIn(dir);
      const stale = declared.filter((e) => !read.has(e.key) && ![...found.keys()].some((k) => covers(e, k))).map((e) => e.key);
      expect(stale, 'declared but no code keeps it').toEqual([]);
    });
  }

  it('the registry lists core\'s keys then each listed extension\'s stores, owned by it', () => {
    const keys = CONTRIBUTIONS.storageKeys;
    expect(keys.slice(0, CORE_STORAGE_KEYS.length)).toEqual(CORE_STORAGE_KEYS);
    for (const e of EXTENSIONS) for (const s of e.stores ?? []) expect(keys).toContainEqual(expect.objectContaining({ key: s.legacyKey, owner: e.id }));
    expect(new Set(keys.map((k) => k.key)).size).toBe(keys.length);
  });

  it('refuses a store whose key core or another extension claims, or one inside a family core reserves', () => {
    const ext = (id: string, legacyKey: string): Extension => ({ id, branches: [], dials: [], nodes: [], derive: () => [], stores: [{ name: 'x', kind: 'item', legacyKey, description: 'x' }] });
    expect(() => foldContributions([ext('a', 'thoremin-controls')])).toThrow(/storage key "thoremin-controls", which core already declares/);
    expect(() => foldContributions([ext('a', 'thoremin.mine'), ext('b', 'thoremin.mine')])).toThrow(/"a" and "b" both declare the storage key "thoremin.mine"/);
    expect(() => foldContributions([ext('a', 'thoremin:plugin:assistant:apiKey:mine')])).toThrow(/inside the family/);
    expect(foldContributions([ext('a', 'thoremin.mine')]).storageKeys.at(-1)).toEqual({ key: 'thoremin.mine', kind: 'localStorage', owner: 'a', purpose: 'x' });
  });

  it('the declarations are not scanned: a key only the registry names is not "kept"', () => {
    // `src/host` writes no browser storage itself: every key in its registry is someone else's.
    const inHost = candidatesIn(['src/host']);
    expect([...inHost.keys()].filter((k) => listed(CORE_STORAGE_KEYS, k))).toEqual([]);
  });

  it('the scan finds keys in constants, in storage calls and in template starts, and ignores the rest', () => {
    expect(keyCandidates("localStorage.getItem('asl.weights')", true)).toEqual(['asl.weights']);
    expect(keyCandidates("localStorage.getItem('asl.weights')")).toEqual([]);
    expect(keyCandidates("const p = hostCollection('thoremin.y');")).toEqual(['thoremin.y']);
    expect(keyCandidates("export const MY_KEY = 'thoremin.a';\nconst label = 'thoremin.not';")).toEqual(['thoremin.a']);
    expect(keyCandidates("localStorage.setItem('thoremin.b', '1'); const t = `thoremin:x:${p}`;").sort()).toEqual(['thoremin.b', 'thoremin:x:']);
    expect(keyCandidates("import x from '@thoremin/sdk'; const id = 'carve.capture.toggle';")).toEqual([]);
  });
});
