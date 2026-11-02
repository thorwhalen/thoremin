/**
 * A provider's licence URL in words (Creative Commons and public-domain marks), for the panel.
 * Display only: a licence never widens an item's rights, and an unknown one reads 'not stated'.
 */
import type { Licence } from './types';

export const LICENCE_NOT_STATED = 'not stated';

/** `http://creativecommons.org/licenses/by-nc-nd/2.5/` -> `CC BY-NC-ND 2.5`. */
export function licenceFromUrl(url: string | null | undefined): Licence {
  if (!url || typeof url !== 'string') return { name: LICENCE_NOT_STATED };
  const u = url.trim();
  const m = /creativecommons\.org\/(licenses|publicdomain)\/([a-z0-9-]+)\/?([0-9.]+)?/i.exec(u);
  if (!m) return { name: u, url: u };
  const [, kind, code, version] = m;
  const v = version ? ` ${version}` : '';
  if (kind.toLowerCase() === 'publicdomain') {
    if (code.toLowerCase() === 'zero') return { name: `CC0${v}`, url: u };
    if (code.toLowerCase() === 'mark') return { name: `Public Domain Mark${v}`, url: u };
    return { name: 'Public domain', url: u };
  }
  if (code.toLowerCase() === 'publicdomain') return { name: 'Public domain', url: u };
  return { name: `CC ${code.toUpperCase()}${v}`, url: u };
}
