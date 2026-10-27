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
