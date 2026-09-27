/**
 * InstrumentPicture — an instrument's picture in the gallery (Round 4, #272), or, when it
 * has none or it fails to load, a tile in its class's colour with a glyph that tells it
 * apart from its neighbours: its own emoji, else its air instrument's, else its initials
 * (the usual avatar fallback: a gallery of identical glyphs would say nothing).
 *
 * The picture is a REFERENCE on the instrument spec (`image`: a URL, or a path relative to
 * the app, e.g. `instruments/air-drum.webp` under `public/`), never bytes (Decision 7).
 *
 * Loading follows the frontend-UX rule (feedback within the Doherty threshold, never stale
 * content under a load): a shimmer the instant the source changes, the picture faded in on
 * load, the tile on error. `key={src}` gives each source a fresh element, so a previous
 * picture can never linger while the next one loads, and the load state is tracked against
 * the source it belongs to.
 */
import { useState } from 'react';

/** Resolve a picture reference: a URL (any case) or a site-absolute path (`/x`, `//host/x`)
 *  as it is, anything else relative to where the app is served (`public/` in the build). */
export function resolvePicture(ref: string, base: string = import.meta.env.BASE_URL ?? '/'): string {
  if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(ref)) return ref;
  return `${base.endsWith('/') ? base : `${base}/`}${ref}`;
}

/** Up to two initials of a name ("Wrist Theremin" → "WT", "Pentatonic" → "PE"). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/[\s&_-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function Tile({ emoji, name, colour }: { emoji?: string; name: string; colour: string }) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center ${emoji ? 'text-3xl' : 'font-mono text-2xl font-bold tracking-wider text-white/70'}`}
      style={{ background: `color-mix(in srgb, ${colour} 28%, #0b0b0b)` }}
      aria-hidden
    >
      {emoji ?? initialsOf(name)}
    </div>
  );
}

function Picture({ src, alt, emoji, colour }: { src: string; alt: string; emoji?: string; colour: string }) {
  // `alt` names the instrument for the fallback tile's initials; the <img> itself is decorative.
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  if (state === 'error') return <Tile emoji={emoji} name={alt} colour={colour} />;
  return (
    <div className="relative h-full w-full" aria-busy={state === 'loading'}>
      {state === 'loading' && <div className="absolute inset-0 animate-pulse bg-white/10" aria-hidden />}
      <img
        src={src}
        // Decorative: the card's name is right beside it (a named alt would be read twice).
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
        // A cached picture is `complete` before React attaches onLoad: no flash for it.
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0 && state === 'loading') setState('loaded');
        }}
        className={`h-full w-full object-cover transition-opacity duration-300 ${state === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}

export default function InstrumentPicture({
  image,
  name,
  emoji,
  colour,
}: {
  /** The spec's `image` reference, if any. */
  image?: string;
  name: string;
  /** Shown on the tile when there is no picture; absent, the tile shows the initials. */
  emoji?: string;
  /** The class colour the tile is tinted with. */
  colour: string;
}) {
  if (!image) return <Tile emoji={emoji} name={name} colour={colour} />;
  const src = resolvePicture(image);
  return <Picture key={src} src={src} alt={name} emoji={emoji} colour={colour} />;
}
