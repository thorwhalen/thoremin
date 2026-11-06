/**
 * Startup source selection (Stream Applier, milestone M-A).
 *
 * Decides which primary source feeds the instrument at launch: the live camera
 * (default) or a pre-recorded video file (camera-free), so the overlays and the
 * command palette can run without a webcam. This is the minimal URL seam; the
 * async-iterator `Source` contract + `source` slot (M-C) will generalize it.
 * See docs/design/stream-applier.md.
 */

/** The selected primary source. Origin-tagged; the host (useEngine) branches on
 *  `kind` to acquire the underlying `<video>` (camera stream vs file). */
export type SourceSpec =
  | { kind: 'camera' }
  | { kind: 'video'; url: string; mirrored?: boolean };

/** Default when nothing is requested: the live webcam. */
export const DEFAULT_SOURCE: SourceSpec = { kind: 'camera' };

/**
 * Parse a URL query string into a {@link SourceSpec}.
 *
 * `?source=video&video=<url>` (alias `clip=<url>`) plays a pre-recorded file as
 * the primary source. Anything else — including `source=video` with a missing or
 * blank url — falls back to the live camera (a missing url warns, since
 * camera-free was the likely intent).
 *
 * Notes for the `<url>`:
 *  - Prefer a **same-origin** clip (e.g. dropped in `public/`, referenced as
 *    `/clip.mp4`). A remote clip must be **CORS-enabled** — the frames are read
 *    into a canvas + MediaPipe, which taints (and blocks) a non-CORS source.
 *  - **Percent-encode** the value if it contains `&` or its own `?query`, or
 *    `URLSearchParams` will truncate it at the first delimiter.
 *  - The view **mirrors** the video (the selfie view), and the hand model names
 *    each hand as the person's own on an unmirrored clip (#995), as on the live
 *    camera. A clip that is itself a mirror image (the recorder's overlay video)
 *    needs `&mirrored=1`, so the source swaps the labels back.
 *
 * @param search a `location.search` string (leading `?` optional).
 */
export function parseSourceSpec(search: string): SourceSpec {
  const params = new URLSearchParams(search);
  if (params.get('source') === 'video') {
    const url = (params.get('video') ?? params.get('clip'))?.trim();
    if (url) return params.get('mirrored') === '1' ? { kind: 'video', url, mirrored: true } : { kind: 'video', url };
    console.warn('[thoremin] ?source=video needs a non-empty &video=<url>; falling back to the camera');
  }
  return DEFAULT_SOURCE;
}
