/**
 * The wasm fileset the app loads from the CDN must be the version of the JS API it
 * imports: tasks-vision's wasm and its JS bundle are released together and a mismatch
 * fails at model load, in the browser, not at build time. This is the build-time check.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TASKS_VISION_VERSION } from '@thoremin/sdk/sources/tasks_vision';

describe('tasks-vision pin', () => {
  it('the wasm version constant equals the installed package version', () => {
    const pkg = JSON.parse(readFileSync('node_modules/@mediapipe/tasks-vision/package.json', 'utf8'));
    expect(TASKS_VISION_VERSION).toBe(pkg.version);
  });
});
