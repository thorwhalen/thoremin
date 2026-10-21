/**
 * Where the in-app player guide lives, as pure functions (no imports): the generator
 * (`scripts/gen_guide.ts`) and the app both build every guide address here, so a link in the
 * instrument editor and the page it points to can never be spelled two ways.
 *
 * The guide is static HTML in `public/guide/`, served at `<base>guide/` next to the manual.
 * One page per shipped instrument (`instruments/<slug>.html`), one per tool (`tools/<id>.html`),
 * one page per area, and a settings page whose sections have anchors. The maintenance rules are in
 * the `thoremin-dev-guide` skill.
 */

/** The guide's home, relative to the app's base (the same way the manual is linked). */
export const GUIDE_HOME = 'guide/index.html';

/**
 * The whole guide as one file, relative to the guide's own folder: one page of HTML (also the PDF
 * route, printed) and the same content as Markdown. Both are generated with the pages.
 */
export const GUIDE_EXPORTS = { html: 'thoremin-guide.html', md: 'thoremin-guide.md' } as const;

/** Where the live guide is served: the exports point their pictures and the app's links here. */
export const GUIDE_LIVE_URL = 'https://apps.thorwhalen.com/thoremin/guide/';

/** `Chord Map + Face` -> `chord-map-face`: lower-case words joined by single dashes. */
export function guideSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A shipped instrument's page. */
export const instrumentPage = (name: string): string => `guide/instruments/${guideSlug(name)}.html`;
/** A tool's page. */
export const toolPage = (toolId: string): string => `guide/tools/${guideSlug(toolId)}.html`;
/** An area's page. */
export const areaPage = (area: string): string => `guide/areas/${guideSlug(area)}.html`;
/** A settings section's anchor on the settings page. */
export const settingsAnchor = (label: string): string => `guide/settings.html#${guideSlug(label)}`;

/**
 * Where the guide explains an instrument: its own page when it is a shipped one (`shipped` lists
 * their names), else the area page named like its class (every instrument class has one: a guard
 * checks), else the guide's home.
 */
export function guideLinkFor(name: string | undefined, classId: string | undefined, shipped: ReadonlySet<string>): { href: string; own: boolean } {
  if (name && shipped.has(name)) return { href: instrumentPage(name), own: true };
  return { href: classId ? areaPage(classId) : GUIDE_HOME, own: false };
}
