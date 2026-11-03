/**
 * A body clip folder outside the repository (#861): `loadClip` takes a path as well as a
 * fixture name, and `clipDirs` lists every fixture-shaped folder under a root, so a corpus
 * exported to the app-data dir (terpsi's clips, whose licences keep them local) is measured
 * by `measure_channels.ts --root` exactly as the committed fixtures are.
 */
import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURES, loadClip, clipDirs } from '../../scripts/body/lib_clips';

describe('body clip folders outside the fixtures', () => {
  it('loads a copied fixture by its path the same as by its name, and lists only complete folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'clip-folders-'));
    try {
      cpSync(join(FIXTURES, 'video_body_budots'), join(root, 'budots_copy'), { recursive: true });
      mkdirSync(join(root, 'not_a_clip'));
      const byName = loadClip('video_body_budots');
      const byPath = loadClip(join(root, 'budots_copy'));
      expect(byPath.name).toBe('budots_copy');
      expect(byPath.frames.length).toBe(byName.frames.length);
      expect(byPath.grid).toEqual(byName.grid);
      expect(byPath.phaseKnown).toBe(byName.phaseKnown);
      expect(clipDirs(root)).toEqual([join(root, 'budots_copy')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the clips a script runs on (#861)', () => {
  it('a root lists its folders; named clips win over the defaults; flags are declared and strict', async () => {
    const { parseClipArgs } = await import('../../scripts/body/lib_clips');
    const root = mkdtempSync(join(tmpdir(), 'clip-args-'));
    const empty = mkdtempSync(join(tmpdir(), 'clip-args-empty-'));
    try {
      cpSync(join(FIXTURES, 'video_body_budots'), join(root, 'a'), { recursive: true });
      const speed = { speed: { type: 'string' as const } };
      const summary = { summary: { type: 'boolean' as const } };
      expect(parseClipArgs(['--', '--root', root], { defaults: ['x'] }).clips).toEqual([join(root, 'a')]);
      expect(parseClipArgs([`--root=${root}/`], { defaults: ['x'] }).clips).toEqual([join(root, 'a')]);
      expect(parseClipArgs(['--speed', '1.5', 'video_body_budots'], { defaults: ['x'], options: speed })).toMatchObject({ clips: ['video_body_budots'], values: { speed: '1.5' } });
      // A flag that takes no value never swallows the clip after it.
      expect(parseClipArgs(['--summary', 'video_body_budots'], { defaults: ['x'], options: summary }).clips).toEqual(['video_body_budots']);
      expect(parseClipArgs([], { defaults: ['x', 'y'] }).clips).toEqual(['x', 'y']);
      // Refused, never measuring nothing or the wrong thing.
      expect(() => parseClipArgs(['--root', empty], { defaults: [] })).toThrow(/no clip folder/);
      expect(() => parseClipArgs(['--root', root, 'video_body_budots'], { defaults: [] })).toThrow(/one or the other/);
      expect(() => parseClipArgs(['--root', '--speed', '2'], { defaults: [], options: speed })).toThrow();
      expect(() => parseClipArgs(['--unknown'], { defaults: [] })).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
