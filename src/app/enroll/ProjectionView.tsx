/**
 * ProjectionView (#163 §7-§8) — see the take laid out, drag to select, name the group.
 *
 * The projection (`store.project()`) lays the still-points out in 2-D with UMAP over the
 * model's own metric; this view draws them, lets the player drag a rectangle to select
 * points, and turns a named selection into a category. The categories are computed in
 * FULL feature space by the store (`labelSelection` → `session.modelFor`); a 2-D
 * centroid would be meaningless to the classifier, so this view never computes one — it
 * only ever passes point INDICES to the store.
 *
 * A live cursor (`store.cursorAt`) shows where the current pose falls in the same
 * embedding, polled at UI rate off the same live vector the runner samples.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { readLiveVector } from './liveVector';
import { useTrainer } from './store';
import { selectInRect, type Point2 } from '@/enroll';

const W = 340;
const H = 240;
const PAD = 16;
const CURSOR_MS = 100;

/** Map a layout point to canvas pixels within the bounds. */
function makeScale(layout: Point2[]) {
  const xs = layout.map((p) => p[0]);
  const ys = layout.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sx = (maxX - minX) || 1;
  const sy = (maxY - minY) || 1;
  const toPx = (p: Point2): Point2 => [PAD + ((p[0] - minX) / sx) * (W - 2 * PAD), PAD + ((p[1] - minY) / sy) * (H - 2 * PAD)];
  const toData = (px: number, py: number): Point2 => [minX + ((px - PAD) / (W - 2 * PAD)) * sx, minY + ((py - PAD) / (H - 2 * PAD)) * sy];
  return { toPx, toData };
}

const GROUP_COLORS = ['#34d399', '#f59e0b', '#60a5fa', '#f472b6', '#a78bfa', '#facc15', '#fb7185', '#4ade80'];

export default function ProjectionView() {
  const layout = useTrainer((s) => s.layout);
  const selection = useTrainer((s) => s.selection);
  const labelGroups = useTrainer((s) => s.labelGroups);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [cursor, setCursor] = useState<Point2 | null>(null);
  const [name, setName] = useState('');

  const scale = useMemo(() => (layout.length ? makeScale(layout) : null), [layout]);
  const groupOf = useMemo(() => {
    const m = new Map<number, number>();
    labelGroups.forEach((g, gi) => g.members.forEach((i) => m.set(i, gi)));
    return m;
  }, [labelGroups]);

  // Poll the live cursor while the view is up.
  useEffect(() => {
    if (!layout.length) return;
    const id = setInterval(() => {
      const live = readLiveVector();
      setCursor(live ? useTrainer.getState().cursorAt(live.vector) : null);
    }, CURSOR_MS);
    return () => clearInterval(id);
  }, [layout.length]);

  // Draw.
  useEffect(() => {
    const c = canvasRef.current;
    const g = c?.getContext('2d');
    if (!c || !g || !scale) return;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, 0, W, H);
    const sel = new Set(selection);
    layout.forEach((p, i) => {
      const [x, y] = scale.toPx(p);
      const gi = groupOf.get(i);
      g.beginPath();
      g.arc(x, y, sel.has(i) ? 5 : 3.5, 0, Math.PI * 2);
      g.fillStyle = sel.has(i) ? '#ffffff' : gi !== undefined ? GROUP_COLORS[gi % GROUP_COLORS.length] : 'rgba(255,255,255,0.45)';
      g.fill();
    });
    if (cursor) {
      const [x, y] = scale.toPx(cursor);
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.strokeStyle = '#f43f5e';
      g.lineWidth = 2;
      g.stroke();
    }
    if (drag) {
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.setLineDash([4, 3]);
      g.strokeRect(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      g.setLineDash([]);
    }
  }, [layout, selection, groupOf, cursor, drag, scale]);

  if (!layout.length) return null;

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onDown = (e: React.PointerEvent) => {
    const { x, y } = pos(e);
    setDrag({ x0: x, y0: y, x1: x, y1: y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { x, y } = pos(e);
    setDrag({ ...drag, x1: x, y1: y });
  };
  const onUp = () => {
    if (!drag || !scale) return;
    const a = scale.toData(drag.x0, drag.y0);
    const b = scale.toData(drag.x1, drag.y1);
    useTrainer.getState().select(selectInRect(layout, { x0: a[0], y0: a[1], x1: b[0], y1: b[1] }));
    setDrag(null);
  };

  return (
    <div className="space-y-1.5" data-projection>
      <p className="text-[10px] uppercase tracking-widest text-white/40">Your poses · drag to select, then name the group</p>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        aria-label="Projection of your held poses"
        className="w-full touch-none rounded-lg border border-white/10 bg-black/40"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      />
      <div className="flex items-center gap-1.5">
        <input
          aria-label="Name for the selected group"
          placeholder={selection.length ? `name these ${selection.length}…` : 'select some points first'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded bg-white/5 px-2 py-1 text-[11px] text-white/85 placeholder:text-white/25"
        />
        <button
          type="button"
          disabled={!selection.length || name.trim() === ''}
          onClick={() => {
            useTrainer.getState().labelSelection(name.trim());
            setName('');
          }}
          className="rounded bg-emerald-500/80 px-2 py-1 text-[10px] font-bold text-black transition hover:bg-emerald-400 disabled:opacity-30"
        >
          Label
        </button>
      </div>
      {labelGroups.length > 0 && (
        <ul className="space-y-0.5" aria-label="Labelled groups">
          {labelGroups.map((grp, gi) => (
            <li key={grp.name} className="flex items-center gap-2 text-[11px]" data-label-group={grp.name}>
              <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLORS[gi % GROUP_COLORS.length] }} aria-hidden />
              <span className="flex-1 truncate text-white/80">{grp.name}</span>
              <span className="text-[10px] tabular-nums text-white/35">{grp.members.length}</span>
              <button
                type="button"
                aria-label={`Remove ${grp.name}`}
                onClick={() => useTrainer.getState().removeLabelGroup(grp.name)}
                className="rounded px-1 text-white/40 hover:bg-white/10 hover:text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
