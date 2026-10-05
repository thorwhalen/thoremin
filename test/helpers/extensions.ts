/**
 * Which extensions this test run's build lists (`extensions.json`, or the file
 * `THOREMIN_EXTENSIONS` names). The core-alone run (`npm run test:core`) lists none, so a
 * test that exercises an extension says so with `describe.runIf(AIR)` / `it.runIf(AIR)`,
 * and a core test whose expectation counts an extension's nodes or keys branches on it.
 * Core must pass with no extensions: that is the guard, and this flag is how a test opts out
 * of it honestly instead of failing there.
 */
import { EXTENSIONS } from '@/extensions';

export const hasExtension = (id: string): boolean => EXTENSIONS.some((e) => e.id === id);

/** True when the build ships the air instruments. */
export const AIR = hasExtension('air');
