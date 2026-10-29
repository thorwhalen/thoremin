/**
 * funfon's home (`play/index.html`) links every standalone page, and each page links back to it:
 * a game nobody can find from the home is not shipped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PLAY_PAGES } from '../../play/pages';

describe('the funfon home', () => {
  const home = readFileSync('play/index.html', 'utf8');
  it.each(PLAY_PAGES)('links %s, and it links home', (page) => {
    expect(home).toContain(`href="./${page}.html"`);
    expect(readFileSync(`play/${page}.html`, 'utf8')).toContain('href="./"');
  });
  it('links nothing that is not a page', () => {
    const linked = [...home.matchAll(/href="\.\/([a-z-]+)\.html"/g)].map((m) => m[1]);
    expect(new Set(linked)).toEqual(new Set(PLAY_PAGES));
  });
});
