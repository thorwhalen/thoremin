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
  read: (options: { count: number }) => LiveBars | null;
  /** The body part, for the empty state ("No face in view"). */
  part?: string;
  /** What one category is called in the legend ("face"). */
  one?: string;
  rateMs?: number;
}

export function FeatureBars({ read, part = 'body part', one = 'category', rateMs = FEATURE_BARS_DEFAULTS.rateMs }: FeatureBarsProps) {
  const [more, setMore] = useState(false);
  const count = more ? BARS_DEFAULTS.more : BARS_DEFAULTS.count;
  const [bars, setBars] = useState<LiveBars | null>(() => read({ count }));
  useEffect(() => {
    setBars(read({ count }));
    const timer = setInterval(() => setBars(read({ count })), rateMs);
    return () => clearInterval(timer);
  }, [read, count, rateMs]);

  if (!bars) return null;
  const inView = bars.bars.some((b) => b.value !== null);
  return (
    <section data-feature-bars={bars.ranking} className="space-y-1">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/50">
        What the camera reads <span className="font-normal normal-case tracking-normal text-white/40">({bars.reference === 'rest' ? 'from your rest' : 'from the last moments'}, in noise units)</span>
      </h4>
      {!inView && <p className="text-[10px] text-amber-200/80">{`No ${part} in view, or still learning how much it jitters.`}</p>}
      <ul className="space-y-0.5">
        {bars.bars.map((b) => (
          <li key={b.id} data-feature-bar={b.id} className="flex items-center gap-1.5 text-[10px]">
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
          {bars.categories >= 2 ? `The ticks are your ${bars.categories} ${one}s so far; these features tell them apart.` : bars.categories === 1 ? `The tick is your first ${one}.` : 'The features that moved most lately.'}
        </span>
        <button type="button" className="underline hover:text-white/70" onClick={() => setMore((m) => !m)}>
          {more ? 'fewer' : 'more'}
        </button>
      </p>
    </section>
  );
}

export default FeatureBars;
