// @vitest-environment jsdom
/**
 * The guide is reachable from the app (the shipping rule): the Tools menu lists a "Guide" link that
 * opens the guide's home in a new tab, and an instrument's editor links to ITS page when it is a
 * shipped one, to its area's page when it is a player's own, and to the home otherwise. The
 * addresses come from one module (`src/app/guide/links.ts`), which the generator also uses.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GuideLink } from '@/app/guide/GuideLink';
import { GUIDE_HOME, guideLinkFor, guideSlug, instrumentPage, toolPage } from '@/app/guide/links';
import { TOOLS } from '@/app/tools';

afterEach(cleanup);

describe('guide addresses', () => {
  it('slugs are lower-case words joined by dashes', () => {
    expect(guideSlug('Chord Map + Face')).toBe('chord-map-face');
    expect(guideSlug('Bell & Strings')).toBe('bell-and-strings');
    expect(guideSlug('Play Along (microphone)')).toBe('play-along-microphone');
    expect(instrumentPage('Air Drum')).toBe('guide/instruments/air-drum.html');
    expect(toolPage('hand-shapes')).toBe('guide/tools/hand-shapes.html');
  });

  it('a shipped instrument has its own page; a player\'s own falls back to its area, then to the home', () => {
    const shipped = new Set(['Air Drum']);
    expect(guideLinkFor('Air Drum', 'air', shipped)).toEqual({ href: 'guide/instruments/air-drum.html', own: true });
    expect(guideLinkFor('My Drum', 'air', shipped)).toEqual({ href: 'guide/areas/air.html', own: false });
    expect(guideLinkFor('Mine', 'mystery', shipped)).toEqual({ href: GUIDE_HOME, own: false });
  });
});

describe('the guide is reachable', () => {
  it('the Tools menu lists a Guide link to the guide\'s home', () => {
    const guide = TOOLS.find((t) => t.id === 'guide');
    expect(guide).toMatchObject({ kind: 'link', group: 'help', href: GUIDE_HOME });
  });

  it('the editor links to the instrument\'s page in a new tab', () => {
    render(<GuideLink name="Air Drum" classId="air" shipped={new Set(['Air Drum'])} />);
    const a = screen.getByTestId('guide-link') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('guide/instruments/air-drum.html');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.dataset.own).toBe('true');
  });
});
