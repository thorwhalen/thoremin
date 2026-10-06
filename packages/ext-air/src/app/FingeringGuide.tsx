/**
 * The fingering guide (#263) — two schematic hands showing which fingers are down for a
 * note, as the prior expects them.
 *
 * Pure SVG from a finger list: no chart lookup here. The caller passes what
 * `expectedFingering` returned, so the guide draws the shape the prior listens for (the
 * flute's "one and one" Bb, not the thumb Bb a camera cannot tell from B) and the two can
 * never disagree. Down fingers are filled; up fingers are outlined and drawn longer, as a
 * lifted finger reads on the video. The keys the fingers work are the caption, and the
 * other notes the same shape plays are said, so a player is not surprised when E4 and E5
 * look alike.
 *
 * Hands are drawn palm-away, as the player sees their own hands in the mirrored video:
 * the left hand on the left with its thumb inward, the right on the right.
 */
import type { FingerId } from '../lib/fingerings';

export interface FingeringGuideProps {
  /** The note (or any label) shown above the hands. */
  label: string;
  down: readonly FingerId[];
  keys?: readonly string[];
  /** The other notes this shape plays (the class's notes, minus `label`). */
  alsoPlays?: readonly string[];
  /** Pixel width of the whole guide (both hands). Default 180. */
  width?: number;
  /** A muted rendering for the NEXT target next to the current one. */
  dim?: boolean;
}

/** Finger geometry per hand, in a 100 x 100 box, palm-away. `x` is the finger's base,
 *  `len` its length when up (down is shorter: the finger folds toward the palm). */
const FINGERS: { id: '1' | '2' | '3' | '4'; x: number; len: number }[] = [
  { id: '1', x: 30, len: 46 },
  { id: '2', x: 47, len: 52 },
  { id: '3', x: 64, len: 48 },
  { id: '4', x: 80, len: 38 },
];
const FINGER_W = 12;
const PALM = { x: 22, y: 52, w: 70, h: 40, r: 10 };
const DOWN_FRACTION = 0.45;

function Hand({ side, down, dim }: { side: 'L' | 'R'; down: ReadonlySet<FingerId>; dim?: boolean }) {
  const fill = dim ? 'rgba(52,211,153,0.35)' : 'rgb(52,211,153)';
  const stroke = dim ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.8)';
  const thumbDown = down.has(`${side}T` as FingerId);
  // The right hand is the left mirrored, so both thumbs point inward.
  const mirror = side === 'R' ? 'translate(100 0) scale(-1 1)' : undefined;
  return (
    <g transform={mirror} data-hand={side}>
      <rect x={PALM.x} y={PALM.y} width={PALM.w} height={PALM.h} rx={PALM.r} fill="none" stroke={stroke} strokeWidth={2} />
      {FINGERS.map((f) => {
        const id = `${side}${f.id}` as FingerId;
        const isDown = down.has(id);
        const len = isDown ? f.len * DOWN_FRACTION : f.len;
        return (
          <rect
            key={f.id}
            data-finger={id}
            data-state={isDown ? 'down' : 'up'}
            x={f.x - FINGER_W / 2}
            y={PALM.y + 2 - len}
            width={FINGER_W}
            height={len}
            rx={FINGER_W / 2}
            fill={isDown ? fill : 'none'}
            stroke={stroke}
            strokeWidth={2}
          />
        );
      })}
      {/* The thumb: a short bar at the palm's inner edge, angled inward. */}
      <rect
        data-finger={`${side}T`}
        data-state={thumbDown ? 'down' : 'up'}
        x={PALM.x - 6}
        y={PALM.y + 8}
        width={FINGER_W}
        height={thumbDown ? 16 : 30}
        rx={FINGER_W / 2}
        transform={`rotate(-35 ${PALM.x} ${PALM.y + 8})`}
        fill={thumbDown ? fill : 'none'}
        stroke={stroke}
        strokeWidth={2}
      />
    </g>
  );
}

export function FingeringGuide({ label, down, keys = [], alsoPlays = [], width = 180, dim }: FingeringGuideProps) {
  const set = new Set(down);
  return (
    <figure className={`inline-flex flex-col items-center gap-1 ${dim ? 'opacity-70' : ''}`} data-testid="fingering-guide" data-label={label}>
      <figcaption className={`font-mono ${dim ? 'text-sm text-white/60' : 'text-lg font-bold text-emerald-300'}`}>{label}</figcaption>
      <svg width={width} height={width / 2} viewBox="0 0 200 100" role="img" aria-label={`Fingering for ${label}: ${describeFingering(down)}`}>
        <Hand side="L" down={set} dim={dim} />
        <g transform="translate(100 0)">
          <Hand side="R" down={set} dim={dim} />
        </g>
      </svg>
      {!dim && keys.length > 0 && <div className="text-[10px] text-white/50">{keys.join(', ')}</div>}
      {!dim && alsoPlays.length > 0 && <div className="text-[10px] text-white/40">also plays {alsoPlays.join(', ')}</div>}
    </figure>
  );
}

const FINGER_NAMES: Record<string, string> = { T: 'thumb', '1': 'index', '2': 'middle', '3': 'ring', '4': 'little' };

/** "left thumb, index, middle; right little" — the accessible name and the voice's. */
export function describeFingering(down: readonly FingerId[]): string {
  if (down.length === 0) return 'all fingers up';
  const side = (s: 'L' | 'R') => down.filter((f) => f.startsWith(s)).map((f) => FINGER_NAMES[f.slice(1)]);
  const parts: string[] = [];
  const l = side('L');
  const r = side('R');
  if (l.length) parts.push(`left ${l.join(', ')}`);
  if (r.length) parts.push(`right ${r.join(', ')}`);
  return parts.join('; ');
}
