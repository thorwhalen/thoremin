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

/** The areas the instrument pages are grouped into (their page is `guide/areas/<id>.html`). */
export const GUIDE_AREAS = ['field', 'air', 'chords', 'sign'] as const;
export type GuideArea = (typeof GUIDE_AREAS)[number];

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

/** The area page an instrument class falls back to (a player's own instruments have no page). */
const AREA_OF_CLASS: Readonly<Record<string, GuideArea>> = { field: 'field', air: 'air', sign: 'sign' };

/**
 * Where the guide explains an instrument: its own page when it is a shipped one (`shipped` lists
 * their names), else its class's area, else the guide's home.
 */
export function guideLinkFor(name: string | undefined, classId: string | undefined, shipped: ReadonlySet<string>): { href: string; own: boolean } {
  if (name && shipped.has(name)) return { href: instrumentPage(name), own: true };
  const area = classId ? AREA_OF_CLASS[classId] : undefined;
  return { href: area ? areaPage(area) : GUIDE_HOME, own: false };
}
