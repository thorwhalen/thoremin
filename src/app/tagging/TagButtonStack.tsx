/**
 * TagButtonStack (#92, design §10) — the in-recording button stack: one button per
 * tag, shown on the left edge while tagging mode is on. Each button carries its
 * number badge (1..9), a kind glyph (a bar for an interval, a dot for a point — a
 * SHAPE difference, not just colour, for accessibility), and the tag label.
 *
 * Status is shown by MOTION: an open interval tag BLINKS (a REC light, so "something
 * is being recorded" reads peripherally); a point tag flashes once on fire. Clicking
 * pushes the same `TagAction` the keyboard digit does (`src` records which), so the
 * two paths are indistinguishable downstream. Purely presentational — a subscriber to
 * the tagging store, part of the build-checked React layer.
 */
import { useEffect, useRef, useState } from 'react';
import type { TagDef } from '@/taglog/affordances';
import { useTagging } from './store';

/** One tag button. A point button flashes briefly when IT fires (via the store, so a
 *  KEYBOARD-triggered point flashes too, not just a click); an interval blinks while open. */
function TagButton({ def, isOpen }: { def: TagDef; isOpen: boolean }) {
  const toggle = useTagging((s) => s.toggle);
  const pulse = useTagging((s) => s.pulse);
  const lastPoint = useTagging((s) => s.lastPoint);
  const [flash, setFlash] = useState(false);
  const prevPulse = useRef(pulse);

  // Flash when this point tag is the just-fired one. Keyed on `pulse` so a repeat
  // fire of the same tag re-triggers; the ref skips the initial mount.
  useEffect(() => {
    if (pulse === prevPulse.current) return;
    prevPulse.current = pulse;
    if (def.kind !== 'point' || lastPoint !== def.id) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 180);
    return () => clearTimeout(id);
  }, [pulse]); // eslint-disable-line react-hooks/exhaustive-deps

  const onClick = () => toggle(def.id, 'click');
  const active = isOpen || flash;
  return (
    <button
      onClick={onClick}
      title={`${def.label} (${def.kind}${def.number ? `, key ${def.number}` : ''})`}
      style={{
        borderColor: def.color,
        backgroundColor: active ? def.color : 'rgba(0,0,0,0.45)',
        color: active ? '#000' : def.color,
      }}
      className={`pointer-events-auto flex w-40 items-center gap-2 rounded-lg border-2 px-2.5 py-1.5 text-left text-xs font-bold uppercase tracking-wide backdrop-blur transition ${
        isOpen ? 'animate-pulse shadow-lg' : ''
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-black/40 text-[10px] text-white/90">
        {def.number ?? '·'}
      </span>
      {/* Kind glyph: a bar = interval, a dot = point (distinct shapes). */}
      <span aria-hidden className="w-3 text-center text-sm leading-none">
        {def.kind === 'interval' ? '▬' : '●'}
      </span>
      <span className="truncate">{def.label}</span>
    </button>
  );
}

export default function TagButtonStack() {
  const mode = useTagging((s) => s.mode);
  const defs = useTagging((s) => s.defs);
  const open = useTagging((s) => s.state.open);
  const recording = useTagging((s) => s.take !== null);

  if (!mode || defs.length === 0) return null;
  return (
    <div className="absolute left-3 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 px-1 text-[9px] uppercase tracking-widest text-white/50">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${recording ? 'animate-pulse bg-red-500' : 'bg-white/30'}`} />
        {recording ? 'tagging · rec' : 'tagging'}
      </div>
      {defs.map((def) => (
        <TagButton key={def.id} def={def} isOpen={open[def.id] !== undefined} />
      ))}
      <div className="mt-0.5 px-1 text-[9px] uppercase tracking-widest text-white/35">1–9 toggle · 0 clears</div>
    </div>
  );
}
