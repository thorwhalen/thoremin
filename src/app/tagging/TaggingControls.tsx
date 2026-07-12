/**
 * AnnotationControls (#92) — the single entry point mounted by `App` for live annotations.
 * It renders the launcher pill (bottom-center) that opens the {@link TaggingSheet}
 * setup surface, plus the always-on subscribers: the {@link TagButtonStack} (shown
 * while annotation mode is on) and the centered {@link Countdown}.
 *
 * Keeping these together behind one component keeps `App` changes minimal. Purely
 * presentational; the tagging store is the single source of truth.
 *
 * VOCABULARY — three nearby nouns, kept deliberately distinct:
 *
 *   - **Annotation** (`Highlighter`, this feature) — a time-anchored point or interval
 *     over a recording, tapped live to segment it. Written to `<take>.annotations.jsonl`.
 *   - **Tag** (`Tags`, `src/app/library/`) — a keyword on a saved instrument preset.
 *   - **Marker** (no icon, `canvas_overlay`) — the "Control markers" overlay element,
 *     i.e. the note-position guides drawn on the video.
 *
 * Annotations and tags used to share BOTH the word "Tags" and the `Tags` icon, which was
 * genuinely confusing. "Marker" was the obvious replacement and is wrong: it is already
 * taken by the overlay element above, so it would have moved the collision rather than
 * removed it. Hence "annotation" — free, and it says exactly what the feature does.
 *
 * Code under `src/taglog/` and this folder keeps the generic `tag` vocabulary of the
 * extraction-ready library; every user-facing string, and every artifact written to
 * disk, says "annotation".
 */
import { useState } from 'react';
import { Highlighter } from 'lucide-react';
import { useTagging } from './store';
import TagButtonStack from './TagButtonStack';
import Countdown from './Countdown';
import TaggingSheet from './TaggingSheet';

export default function TaggingControls() {
  const [open, setOpen] = useState(false);
  const mode = useTagging((s) => s.mode);
  const tagCount = useTagging((s) => s.defs.length);

  return (
    <>
      <TagButtonStack />
      <Countdown />
      <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
        {open && <TaggingSheet onClose={() => setOpen(false)} />}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Annotation mode"
          aria-expanded={open}
          className={`flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-widest backdrop-blur transition ${
            mode ? 'bg-emerald-500 text-black' : 'bg-black/50 text-white/80 hover:text-white'
          }`}
        >
          <Highlighter className="h-3.5 w-3.5" />
          Annotations
          {mode && tagCount > 0 && (
            <span className="rounded-full bg-black/30 px-1.5 text-[9px] tabular-nums">{tagCount}</span>
          )}
        </button>
      </div>
    </>
  );
}
