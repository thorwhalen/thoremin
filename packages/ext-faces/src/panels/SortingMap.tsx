/**
 * The optional map of the holds (#434, design C.3.2): a 2-D Fisher LDA projection (principal axes
 * under three classes) with a live cursor for what the camera sees now, and a dragged rectangle
 * that selects holds for the grid's moves. Off by default and drawn only while the player asks;
 * nothing here is stored, and an edit that moves a hold just redraws it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { readLiveVector } from '@thoremin/sdk-ui/enroll/liveVector';
import { createReader } from '@thoremin/sdk/enroll/modality';
import { ldaProjection } from '@thoremin/sdk/enroll/lda';
import type { FaceSessionState } from '../app/sessionStore';

const W = 340;
const H = 220;
const PAD = 14;
const CURSOR_MS = 100;
const COLORS = ['#34d399', '#f59e0b', '#60a5fa', '#f472b6', '#a78bfa', '#facc15', '#fb7185', '#4ade80', '#22d3ee', '#fb923c', '#c084fc', '#a3e635'];

export function SortingMap({ s, selected, onSelect }: { s: FaceSessionState; selected: ReadonlySet<string>; onSelect: (ids: ReadonlySet<string>) => void }) {
  const c = s.working;
  const ref = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);

  const map = useMemo(() => {
    if (!c) return null;
    const placeOf = new Map<string, number>();
    c.categories.forEach((cat, i) => cat.members.forEach((id) => placeOf.set(id, i)));
    c.neutral.forEach((id) => placeOf.set(id, c.categories.length));
    const classes = c.samples.map((x) => placeOf.get(x.id) ?? -1);
    const m = ldaProjection(c.samples.map((x) => x.vector), classes, c.features, c.weights);
    return m && { ...m, classes };
  }, [c]);

  const frame = useMemo(() => {
    if (!map) return null;
    const pts = [...map.points];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const sx = Math.max(...xs) - x0 || 1;
    const sy = Math.max(...ys) - y0 || 1;
    return {
      toPx: (p: readonly [number, number]): [number, number] => [PAD + ((p[0] - x0) / sx) * (W - 2 * PAD), PAD + ((p[1] - y0) / sy) * (H - 2 * PAD)],
      toData: (x: number, y: number): [number, number] => [x0 + ((x - PAD) / (W - 2 * PAD)) * sx, y0 + ((y - PAD) / (H - 2 * PAD)) * sy],
    };
  }, [map]);

  // The live cursor: the camera's vector as this categorizer reads it, placed on the same plane.
  useEffect(() => {
    if (!c || !map) return;
    const reader = createReader(s.modality, { hand: c.hand ?? 'either', mirror: c.mirror === true });
    const id = setInterval(() => {
      const live = readLiveVector();
      setCursor(live ? map.project(reader(live.vector)) : null);
    }, CURSOR_MS);
    return () => clearInterval(id);
  }, [c, map, s.modality]);

  useEffect(() => {
    const g = ref.current?.getContext('2d');
    if (!g || !map || !frame || !c) return;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, 0, W, H);
    map.points.forEach((p, i) => {
      const [x, y] = frame.toPx(p);
      const k = map.classes[i];
      const isSel = selected.has(c.samples[i].id);
      g.beginPath();
      g.arc(x, y, isSel ? 5 : 3.5, 0, Math.PI * 2);
      g.fillStyle = isSel ? '#ffffff' : k < 0 ? 'rgba(255,255,255,0.2)' : k === c.categories.length ? 'rgba(255,255,255,0.45)' : COLORS[k % COLORS.length];
      g.fill();
    });
    if (cursor) {
      const [x, y] = frame.toPx(cursor);
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
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
  }, [map, frame, c, selected, cursor, drag]);

  if (!c || !map || !frame) return <p className="text-[11px] text-white/50">Not enough holds to draw a map yet.</p>;

  // The canvas is drawn at a fixed backing size but shown at the width it is given.
  const pos = (e: React.PointerEvent) => {
    const canvas = ref.current!;
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (r.width ? canvas.width / r.width : 1), y: (e.clientY - r.top) * (r.height ? canvas.height / r.height : 1) };
  };
  const onUp = () => {
    if (!drag) return;
    const a = frame.toData(drag.x0, drag.y0);
    const b = frame.toData(drag.x1, drag.y1);
    const [lx, hx] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const [ly, hy] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    const moved = Math.abs(drag.x1 - drag.x0) + Math.abs(drag.y1 - drag.y0) > 4;
    onSelect(moved ? new Set(c.samples.filter((_, i) => map.points[i][0] >= lx && map.points[i][0] <= hx && map.points[i][1] >= ly && map.points[i][1] <= hy).map((x) => x.id)) : new Set());
    setDrag(null);
  };
  return (
    <div className="space-y-1" data-faces-map>
      <canvas
        ref={ref}
        width={W}
        height={H}
        aria-label="Map of your holds: each dot is a hold, colored by category; drag a box to select"
        className="w-full touch-none rounded-lg border border-white/10 bg-black/40"
        onPointerDown={(e) => {
          const p = pos(e);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (drag) setDrag({ ...drag, ...(({ x, y }) => ({ x1: x, y1: y }))(pos(e)) });
        }}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      />
      <p className="text-[10px] text-white/40">
        {map.method === 'lda' ? 'The two directions that best pull your categories apart.' : 'Too few categories to pull apart: the two directions the holds vary most.'} The red ring is what the camera sees now. Drag a box to select holds.
      </p>
    </div>
  );
}
