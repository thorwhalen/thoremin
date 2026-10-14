/**
 * Live feature bars (#385 E2): a compact in-panel view of what the camera reads, for any carve
 * modality (and the trainer). The model is `@thoremin/sdk/enroll/bars`; this only draws it.
 *
 * Each bar is centred on the player's rest (or, before the rest, a running baseline) and
 * measured in noise units, on a signed log scale so a one-jitter twitch and a fifty-jitter smile
 * both read: 1 noise unit sits a sixth of the way out, 10 about half, 100 at the end. The faint
 * band is the rest's spread (the neutral zone); a coloured tick marks each category so far,
 * numbered by its first hold; the filled bar is the player now.
 *
 * It reads its snapshot by polling `read` at `rateMs` (the hot-path rule: a holder plus a poll,
 * never a store write per frame), so it re-renders at UI rate whatever the camera's rate.
 *
 * Pins (#402): given `onPinnedChange`, each bar has a pin, and "Pin a feature" offers every
 * feature not shown; a pinned feature always shows, above the ones the bars choose. The host
 * keeps the pins (the faces extension: per modality, per device, `./barPins`).
 */
import { useEffect, useState } from 'react';
import { BARS_DEFAULTS, type LiveBars } from '@thoremin/sdk/enroll/bars';

export const FEATURE_BARS_DEFAULTS = {
  /** How often the bars re-read the model, ms. */
  rateMs: 100,
  /** The noise units at the end of a bar (the log scale's full width). */
  fullScale: 100,
} as const;

/** One colour per category so far, by its number (cycled past eight). */
export const CATEGORY_COLORS = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171', '#2dd4bf', '#fb923c'] as const;

/** Where `z` noise units sit on a bar, from -1 (left end) to 1 (right end). */
export function barPosition(z: number, fullScale: number = FEATURE_BARS_DEFAULTS.fullScale): number {
  const p = Math.log1p(Math.abs(z)) / Math.log1p(fullScale);
  return Math.sign(z) * Math.min(1, p);
}

const pct = (p: number) => `${50 + 50 * p}%`;

export interface FeatureBarsProps {
  /** The bars now (null: nothing is read). Called every `rateMs`. */
  read: (options: { count: number; pinned: readonly string[] }) => LiveBars | null;
  /** The body part, for the empty state ("No face in view"). */
  part?: string;
  /** What one category is called in the legend ("face"). */
  one?: string;
  rateMs?: number;
  /** The features always shown, first (#402). */
  pinned?: readonly string[];
  /** Pin or unpin: the new pinned list. Absent: no pin controls. */
  onPinnedChange?: (ids: string[]) => void;
  /** The most features pinned (the pin controls stop offering more). */
  maxPins?: number;
}

const NONE: readonly string[] = [];

/** A pushpin, drawn: filled when pinned. */
function PinIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" aria-hidden="true">
      <path d="M5 1h6l-1 5 3 3H9.5L8 15l-1.5-6H3l3-3z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function FeatureBars({
  read,
  part = 'body part',
  one = 'category',
  rateMs = FEATURE_BARS_DEFAULTS.rateMs,
  pinned = NONE,
  onPinnedChange,
  maxPins = BARS_DEFAULTS.count,
}: FeatureBarsProps) {
  const [more, setMore] = useState(false);
  const [choice, setChoice] = useState('');
  const count = more ? BARS_DEFAULTS.more : BARS_DEFAULTS.count;
  const pinKey = pinned.join('\n');
  const [bars, setBars] = useState<LiveBars | null>(() => read({ count, pinned }));
  useEffect(() => {
    const ids = pinKey === '' ? [] : pinKey.split('\n');
    setBars(read({ count, pinned: ids }));
    const timer = setInterval(() => setBars(read({ count, pinned: ids })), rateMs);
    return () => clearInterval(timer);
  }, [read, count, rateMs, pinKey]);
  // A pin no feature answers to any more (a renamed catalog id) has no bar and no entry to
  // unpin it from, yet would hold a slot: drop it as soon as the features are known.
  const known = bars?.choices ?? null;
  useEffect(() => {
    if (!onPinnedChange || !known || known.length === 0) return;
    const ids = new Set(known.map((c) => c.id));
    if (pinned.some((id) => !ids.has(id))) onPinnedChange(pinned.filter((id) => ids.has(id)));
  }, [known, pinKey, onPinnedChange]);

  if (!bars) return null;
  const inView = bars.bars.some((b) => b.value !== null);
  const isPinned = (id: string) => pinned.includes(id);
  const togglePin = (id: string) => onPinnedChange?.(isPinned(id) ? pinned.filter((x) => x !== id) : [...pinned, id]);
  const full = pinned.filter((id) => (bars.choices ?? []).some((c) => c.id === id)).length >= maxPins;
  const shownIds = new Set(bars.bars.map((b) => b.id));
  const unshown = (bars.choices ?? []).filter((c) => !shownIds.has(c.id)).sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return (
    <section data-feature-bars={bars.ranking} className="space-y-1">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/50">
        What the camera reads <span className="font-normal normal-case tracking-normal text-white/40">({bars.reference === 'rest' ? 'from your rest' : 'from the last moments'}, in noise units)</span>
      </h4>
      {!inView && <p className="text-[10px] text-amber-200/80">{`No ${part} in view, or still learning how much it jitters.`}</p>}
      <ul className="space-y-0.5">
        {bars.bars.map((b) => (
          <li key={b.id} data-feature-bar={b.id} data-feature-bar-pinned={isPinned(b.id) || undefined} className="flex items-center gap-1.5 text-[10px]">
            {onPinnedChange && (
              <button
                type="button"
                aria-label={`Pin ${b.label}`}
                aria-pressed={isPinned(b.id)}
                title={isPinned(b.id) ? 'Pinned: always shown. Click to unpin.' : full ? `At most ${maxPins} pinned` : 'Pin: always show this one'}
                disabled={!isPinned(b.id) && full}
                onClick={() => togglePin(b.id)}
                className={`-m-1 shrink-0 p-1 ${isPinned(b.id) ? 'text-amber-300' : 'text-white/30 hover:text-white/70'} disabled:opacity-30`}
              >
                <PinIcon on={isPinned(b.id)} />
              </button>
            )}
            <span className="w-24 shrink-0 truncate text-white/70" title={b.id}>
              {b.label}
            </span>
            <span className="relative h-2.5 flex-1 overflow-hidden rounded-sm bg-white/5">
              {b.band !== null && (
                <span
                  className="absolute inset-y-0 bg-white/10"
                  style={{ left: pct(barPosition(-b.band)), right: `${100 - (50 + 50 * barPosition(b.band))}%` }}
                />
              )}
              <span className="absolute inset-y-0 w-px bg-white/30" style={{ left: '50%' }} />
              {b.value !== null && (
                <span
                  data-feature-bar-value
                  className="absolute inset-y-0.5 rounded-sm bg-white/70"
                  style={b.value >= 0 ? { left: '50%', width: `${50 * barPosition(b.value)}%` } : { right: '50%', width: `${-50 * barPosition(b.value)}%` }}
                />
              )}
              {b.ticks.map((z, i) =>
                z === null ? null : (
                  <span
                    key={i}
                    data-feature-bar-tick={i + 1}
                    title={`${one} #${i + 1}`}
                    className="absolute inset-y-0 w-0.5"
                    style={{ left: pct(barPosition(z)), background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                  />
                ),
              )}
            </span>
            <span className="w-7 shrink-0 text-right tabular-nums text-white/50">{b.value === null ? '' : `${b.value > 0 ? '+' : ''}${Math.round(b.value)}`}</span>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-2 text-[9px] text-white/40">
        <span className="flex-1">
          {pinned.length > 0 ? 'Pinned first. ' : ''}
          {bars.categories >= 2 ? `The ticks are your ${bars.categories} ${one}s so far; ${pinned.length > 0 ? 'the others' : 'these features'} tell them apart.` : bars.categories === 1 ? `The tick is your first ${one}.` : 'The features that moved most lately.'}
        </span>
        {onPinnedChange && unshown.length > 0 && (
          <span className="flex items-center gap-1">
            {/* Choosing is not pinning: arrowing through a closed select fires a change per
                option in some browsers, so the pin is its own button. */}
            <select
              aria-label="A feature to pin"
              value={unshown.some((c) => c.id === choice) ? choice : ''}
              disabled={full}
              title={full ? `At most ${maxPins} pinned: unpin one first` : 'Always show a feature the bars do not show now'}
              onChange={(e) => setChoice(e.target.value)}
              className="max-w-28 rounded bg-white/5 text-[9px] text-white/60 disabled:opacity-40"
            >
              <option value="">Pin a feature...</option>
              {unshown.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="underline hover:text-white/70 disabled:no-underline disabled:opacity-40"
              disabled={full || !unshown.some((c) => c.id === choice)}
              onClick={() => {
                togglePin(choice);
                setChoice('');
              }}
            >
              Pin it
            </button>
          </span>
        )}
        <button type="button" className="underline hover:text-white/70" onClick={() => setMore((m) => !m)}>
          {more ? 'fewer' : 'more'}
        </button>
      </p>
    </section>
  );
}

export default FeatureBars;
