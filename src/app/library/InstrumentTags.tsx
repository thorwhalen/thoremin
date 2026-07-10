/**
 * InstrumentTags — the tags column for one instrument row (issues #113/#114): the
 * derived system-tag emojis first, then the custom-tag emojis, each a single glyph with
 * a native tooltip = its label. Read-only; the row's edit gear opens tagging. Kept a tiny
 * presentational component so the list row stays legible.
 */
import type { Tag } from './model';
import type { SystemTag } from './systemTags';

export default function InstrumentTags({
  systemTags,
  customTags,
}: {
  systemTags: SystemTag[];
  customTags: Tag[];
}) {
  if (systemTags.length === 0 && customTags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 pl-6 pr-2 pb-1.5">
      {systemTags.map((t) => (
        <span
          key={t.id}
          role="img"
          title={t.label}
          className="text-xs leading-none opacity-90"
          aria-label={t.label}
        >
          {t.emoji}
        </span>
      ))}
      {systemTags.length > 0 && customTags.length > 0 && (
        <span className="mx-0.5 h-2.5 w-px bg-white/15" aria-hidden />
      )}
      {customTags.map((t) => (
        <span key={t.id} role="img" title={t.label} className="text-xs leading-none" aria-label={t.label}>
          {t.emoji}
        </span>
      ))}
    </div>
  );
}
