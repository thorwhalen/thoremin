/**
 * TaggingControls (#92) — the single entry point mounted by `App` for live tagging.
 * It renders the launcher pill (bottom-center) that opens the {@link TaggingSheet}
 * setup surface, plus the always-on subscribers: the {@link TagButtonStack} (shown
 * while tagging mode is on) and the centered {@link Countdown}.
 *
 * Keeping these together behind one component keeps `App` changes minimal. Purely
 * presentational; the tagging store is the single source of truth.
 */
import { useState } from 'react';
import { Tags } from 'lucide-react';
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
          aria-label="Tagging mode"
          aria-expanded={open}
          className={`flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-widest backdrop-blur transition ${
            mode ? 'bg-emerald-500 text-black' : 'bg-black/50 text-white/80 hover:text-white'
          }`}
        >
          <Tags className="h-3.5 w-3.5" />
          Tags
          {mode && tagCount > 0 && (
            <span className="rounded-full bg-black/30 px-1.5 text-[9px] tabular-nums">{tagCount}</span>
          )}
        </button>
      </div>
    </>
  );
}
