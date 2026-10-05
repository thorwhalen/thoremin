/**
 * The PAD EDITOR of the air drum's settings (#245): place, move, resize and recolour a
 * few shapes on the screen, each a drum, and save the layout.
 *
 * The stage is a small picture of the camera frame AS THE PLAYER SEES IT (mirrored, like
 * the overlay, in the camera's own shape once a frame has arrived), so a pad dragged to
 * the left here is struck by the hand on the left of the video. The video fills the
 * window by cropping (`object-cover`), so the stage outlines the part of the frame the
 * screen actually shows: a pad outside it can be struck but not seen. Drag a pad to move it; drag its corner handle to resize it; click it to
 * choose its drum, shape and colour below. The drag itself is local React state (the
 * picture follows the pointer every frame); the RELEASE is one atomic `dial.patch` of the
 * pad's leaves (`airDrum.pads.<slot>.x` …), so every edit goes through the command write
 * path, like any other panel control, and lands in the undo history as one step.
 *
 * Layouts are a zodal named collection (`src/app/drums/padLayouts.ts`): saving copies
 * the current pads into a named record, loading writes a record back as one patch.
 */
import { useEffect, useRef, useState } from 'react';
import { dispatchDialPatch, dispatchDialSetIn } from '@/app/dispatchDial';
import { useDialsSettings } from '@/app/dials/useDialsSettings';
import { selectCls } from '@/app/dials/primitives';
import { useAirDrumStatus } from '@/extensions/air/app/airDrumStatus';
import { DEFAULT_PADS_SET, DRUM_SOUNDS, MIN_PAD_SIZE, OFF_PAD_MODES, PAD_IDS, PAD_SHAPES, STARTER_KIT, type OffPadMode, type Pad, type PadId, type Pads } from '@thoremin/sdk/nodes/music/drum_pads';
import { createPadLayoutStore, padLayoutWrites, type PadLayoutStore } from '@/extensions/air/app/padLayouts';
import type { NamedSummary } from '@/settings/namedCollection';

/** The stage's height in its own units; its width follows the camera's shape. */
const STAGE_H = 90;
/** The shape assumed before a camera frame has arrived (the usual webcam). */
const DEFAULT_ASPECT = 16 / 9;
/** One arrow-key press moves the chosen pad this far (frame fraction). */
const KEY_STEP = 0.02;
/** The resize handle's size, stage units. */
const HANDLE = 5;

const SOUND_LABEL: Record<Pad['sound'], string> = { kick: 'kick', snare: 'snare', hihat: 'hi-hat', tom: 'tom', crash: 'crash', ride: 'ride' };
const SHAPE_LABEL: Record<Pad['shape'], string> = { circle: 'round', rect: 'square' };
const OFF_PAD_LABEL: Record<OffPadMode, string> = {
  hand: "the hand's own drum",
  nearest: 'the nearest pad (as a rim shot)',
  silent: 'nothing',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The part of a frame of shape `aspect` that a window shows when the video fills it by
 * cropping (`object-cover`, the app shell's canvas), as frame fractions; null when all of
 * it shows (or there is no window to measure).
 */
export function visibleCrop(aspect: number, viewport = typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : null): { x: number; y: number; w: number; h: number } | null {
  if (!viewport || viewport.w <= 0 || viewport.h <= 0) return null;
  const view = viewport.w / viewport.h;
  if (Math.abs(view - aspect) < 1e-3) return null;
  // A wider window keeps the full width and crops top and bottom; a narrower one the reverse.
  if (view > aspect) {
    const h = aspect / view;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = view / aspect;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

let layoutStore: PadLayoutStore | null = null;
/** The layout collection (created on first use: localStorage is the browser default). */
function padLayouts(): PadLayoutStore {
  layoutStore ??= createPadLayoutStore();
  return layoutStore;
}

interface Drag {
  id: PadId;
  mode: 'move' | 'resize';
  /** Where the pointer went down, frame fractions, and the pad as it was. */
  from: { x: number; y: number };
  pad: Pad;
  /** The pad as it is being dragged. */
  now: Pad;
}

/** Write one pad's geometry as one command (the drag's release). */
function commitGeometry(id: PadId, p: Pad): void {
  dispatchDialPatch([
    [`airDrum.pads.${id}.x`, round3(p.x)],
    [`airDrum.pads.${id}.y`, round3(p.y)],
    [`airDrum.pads.${id}.w`, round3(p.w)],
    [`airDrum.pads.${id}.h`, round3(p.h)],
  ]);
}

/** The starter kit: its slots on, in their default places; every other slot off. */
function starterKitWrites(): [string, string | number | boolean][] {
  const kit = Object.fromEntries(PAD_IDS.map((id) => [id, { ...DEFAULT_PADS_SET[id], on: STARTER_KIT.includes(id) }])) as Pads;
  return padLayoutWrites(kit);
}

export function DrumPadEditor({ enabled }: { enabled: boolean }) {
  const { state } = useDialsSettings();
  const c = (state.effective.airDrum ?? {}) as { pads?: Pads; offPad?: OffPadMode; hardHit?: number };
  const pads = c.pads ?? DEFAULT_PADS_SET;
  const offPad = c.offPad ?? 'hand';
  const hardHit = c.hardHit ?? 4;
  const lastPad = useAirDrumStatus((s) => s.live.lastPad);
  const frameAspect = useAirDrumStatus((s) => s.live.frameAspect);
  const aspect = frameAspect > 0 ? frameAspect : DEFAULT_ASPECT;
  const STAGE_W = STAGE_H * aspect;
  const crop = visibleCrop(aspect);
  // A colour being picked belongs to the pad it was picked for, whatever is selected by
  // the time the picker lets go.
  const [colorDraft, setColorDraft] = useState<{ id: PadId; color: string } | null>(null);
  const draftRef = useRef(colorDraft);
  draftRef.current = colorDraft;
  const colorInput = useRef<HTMLInputElement>(null);
  /** The last colour written, so the `change` React also sees after it is not a new draft. */
  const committed = useRef<string | null>(null);
  const commitColor = () => {
    const d = draftRef.current;
    if (!d) return;
    draftRef.current = null;
    committed.current = d.color;
    setColorDraft(null);
    if (d.color !== (pads[d.id]?.color ?? '')) dispatchDialSetIn(`airDrum.pads.${d.id}.color`, d.color);
  };
  const commitColorRef = useRef(commitColor);
  commitColorRef.current = commitColor;
  // The native `change` fires once, when the picker closes (React's onChange is the
  // `input` stream while it is open); a draft still pending when the editor closes is
  // written too.
  useEffect(() => {
    const el = colorInput.current;
    const onChange = () => commitColorRef.current();
    el?.addEventListener('change', onChange);
    return () => el?.removeEventListener('change', onChange);
  });
  useEffect(() => () => commitColorRef.current(), []);
  // The crop outline depends on the window's shape: follow a resize.
  const [, setViewport] = useState(0);
  useEffect(() => {
    const onResize = () => setViewport((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const on = PAD_IDS.filter((id) => pads[id].on);
  const [selected, setSelected] = useState<PadId | null>(null);
  const sel = selected && pads[selected].on ? selected : (on[0] ?? null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Saved layouts: listed on mount and after every save / delete.
  const [layouts, setLayouts] = useState<NamedSummary[]>([]);
  const [layoutName, setLayoutName] = useState('');
  const refresh = () => {
    padLayouts()
      .list()
      .then(setLayouts)
      .catch(() => setLayouts([]));
  };
  useEffect(refresh, []);

  /** Pointer position as frame fractions of the stage. */
  const toFrame = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const start = (id: PadId, mode: Drag['mode']) => (e: React.PointerEvent) => {
    if (!enabled) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSelected(id);
    setDrag({ id, mode, from: toFrame(e), pad: pads[id], now: pads[id] });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toFrame(e);
    const dx = p.x - drag.from.x;
    const dy = p.y - drag.from.y;
    const q = drag.pad;
    const now: Pad =
      drag.mode === 'move'
        ? { ...q, x: clamp(q.x + dx, 0, 1), y: clamp(q.y + dy, 0, 1) }
        : { ...q, w: clamp(q.w + 2 * dx, MIN_PAD_SIZE, 1), h: clamp(q.h + 2 * dy, MIN_PAD_SIZE, 1) };
    setDrag({ ...drag, now });
  };
  const end = () => {
    if (!drag) return;
    const { id, now, pad } = drag;
    setDrag(null);
    if (now.x !== pad.x || now.y !== pad.y || now.w !== pad.w || now.h !== pad.h) commitGeometry(id, now);
  };

  const shown = (id: PadId): Pad => (drag && drag.id === id ? drag.now : pads[id]);
  const firstOff = PAD_IDS.find((id) => !pads[id].on);
  const selPad = sel ? pads[sel] : null;
  const title = on.length ? `${on.length} pad${on.length === 1 ? '' : 's'}` : 'No pads: each hand plays its own drum';

  return (
    <div className="space-y-2" data-testid="drum-pad-editor">
      <div className="flex items-center justify-between text-xs">
        <span>Pads</span>
        <span className="text-[10px] text-white/50">{title}</span>
      </div>
      <p className="text-[10px] leading-relaxed text-white/50">
        Shapes on the screen, each a drum: strike where a pad is drawn over the video. Drag a pad to move it, drag its corner to resize it. Near the rim sounds higher and
        brighter than the centre; a faster stroke is louder.
      </p>
      <svg
        ref={svgRef}
        role="application"
        aria-label="Pad stage"
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        className="w-full touch-none rounded bg-black/40"
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      >
        {crop && (
          <rect
            data-testid="visible-crop"
            x={crop.x * STAGE_W}
            y={crop.y * STAGE_H}
            width={crop.w * STAGE_W}
            height={crop.h * STAGE_H}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.5}
            strokeDasharray="2 2"
            strokeWidth={0.6}
            pointerEvents="none"
          />
        )}
        {PAD_IDS.filter((id) => pads[id].on).map((id) => {
          const p = shown(id);
          const cx = p.x * STAGE_W;
          const cy = p.y * STAGE_H;
          const rw = (p.w * STAGE_W) / 2;
          const rh = (p.h * STAGE_H) / 2;
          const common = {
            fill: p.color,
            fillOpacity: lastPad === id ? 0.75 : 0.4,
            stroke: sel === id ? '#ffffff' : p.color,
            strokeWidth: sel === id ? 1 : 0.6,
            onPointerDown: start(id, 'move'),
            style: { cursor: enabled ? 'move' : 'default' },
          };
          return (
            <g
              key={id}
              data-pad={id}
              aria-label={`Pad ${id}: ${SOUND_LABEL[p.sound]}`}
              role="button"
              tabIndex={enabled ? 0 : -1}
              onClick={() => setSelected(id)}
              onFocus={() => setSelected(id)}
              onKeyDown={(e) => {
                const step: Record<string, [number, number]> = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] };
                const d = step[e.key];
                if (!d || !enabled) return;
                e.preventDefault();
                commitGeometry(id, { ...pads[id], x: clamp(pads[id].x + d[0], 0, 1), y: clamp(pads[id].y + d[1], 0, 1) });
              }}
            >
              {p.shape === 'circle' ? <ellipse cx={cx} cy={cy} rx={rw} ry={rh} {...common} /> : <rect x={cx - rw} y={cy - rh} width={2 * rw} height={2 * rh} {...common} />}
              <text x={cx} y={cy + 2} fontSize={5} textAnchor="middle" fill="#ffffff" pointerEvents="none">
                {SOUND_LABEL[p.sound]}
              </text>
              {sel === id && enabled && (
                <rect
                  data-handle={id}
                  aria-label={`Resize pad ${id}`}
                  x={cx + rw - HANDLE / 2}
                  y={cy + rh - HANDLE / 2}
                  width={HANDLE}
                  height={HANDLE}
                  fill="#ffffff"
                  onPointerDown={start(id, 'resize')}
                  style={{ cursor: 'nwse-resize' }}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-2 text-xs">
        <button type="button" className={selectCls} disabled={!enabled || !firstOff} onClick={() => firstOff && (setSelected(firstOff), dispatchDialSetIn(`airDrum.pads.${firstOff}.on`, true))}>
          Add pad
        </button>
        <button type="button" className={selectCls} disabled={!enabled} onClick={() => dispatchDialPatch(starterKitWrites())}>
          Starter kit
        </button>
        {sel && (
          <button type="button" className={selectCls} disabled={!enabled} onClick={() => dispatchDialSetIn(`airDrum.pads.${sel}.on`, false)}>
            Remove pad
          </button>
        )}
      </div>
      {sel && selPad && (
        <div className="space-y-1 rounded bg-white/5 p-2" data-testid="pad-props">
          <label className="flex items-center justify-between gap-2 text-xs">
            Pad drum
            <select className={selectCls} value={selPad.sound} disabled={!enabled} onChange={(e) => dispatchDialSetIn(`airDrum.pads.${sel}.sound`, e.target.value)}>
              {DRUM_SOUNDS.map((s) => (
                <option key={s} value={s}>
                  {SOUND_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            Pad shape
            <select className={selectCls} value={selPad.shape} disabled={!enabled} onChange={(e) => dispatchDialSetIn(`airDrum.pads.${sel}.shape`, e.target.value)}>
              {PAD_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {SHAPE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            Pad colour
            {/* A colour picker fires on every hue it passes through: the colour follows
                locally and is written once, when the picker lets go. */}
            <input
              ref={colorInput}
              type="color"
              value={colorDraft && colorDraft.id === sel ? colorDraft.color : selPad.color}
              disabled={!enabled}
              onInput={(e) => {
                committed.current = null;
                setColorDraft({ id: sel, color: (e.target as HTMLInputElement).value });
              }}
              onChange={(e) => {
                if (e.target.value !== committed.current) setColorDraft({ id: sel, color: e.target.value });
              }}
              onBlur={commitColor}
            />
          </label>
        </div>
      )}
      <label className="flex items-center justify-between gap-2 text-xs">
        A hit off every pad plays
        <select className={selectCls} value={offPad} disabled={!enabled || on.length === 0} onChange={(e) => dispatchDialSetIn('airDrum.offPad', e.target.value)}>
          {OFF_PAD_MODES.map((m) => (
            <option key={m} value={m}>
              {OFF_PAD_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label
        className="flex items-center justify-between gap-2 text-xs"
        title="How many times faster than your slowest counted stroke a stroke must be to sound at full volume. Lower = everything sounds loud sooner."
      >
        <span>Full volume at ({hardHit.toFixed(1)}x the softest stroke)</span>
        <input
          type="range"
          aria-label="Full volume at"
          min={1.1}
          max={20}
          step={0.1}
          value={hardHit}
          disabled={!enabled}
          className="w-[40%]"
          onChange={(e) => dispatchDialSetIn('airDrum.hardHit', Number(e.target.value))}
        />
      </label>
      <div className="space-y-1">
        <div className="flex gap-2">
          <input
            aria-label="Layout name"
            className={`${selectCls} flex-1`}
            placeholder="Layout name"
            value={layoutName}
            onChange={(e) => setLayoutName(e.target.value)}
          />
          <button
            type="button"
            className={selectCls}
            disabled={!layoutName.trim() || on.length === 0}
            onClick={() => {
              padLayouts()
                .save(layoutName.trim(), pads)
                .then(() => {
                  setLayoutName('');
                  refresh();
                })
                .catch(() => refresh());
            }}
          >
            Save layout
          </button>
        </div>
        {layouts.length > 0 && (
          <ul className="space-y-1" aria-label="Saved pad layouts">
            {layouts.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{l.name}</span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    className={selectCls}
                    aria-label={`Load layout ${l.name}`}
                    disabled={!enabled}
                    onClick={() => {
                      padLayouts()
                        .load(l.id)
                        .then((rec) => rec && dispatchDialPatch(padLayoutWrites(rec.pads)))
                        .catch(() => refresh());
                    }}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className={selectCls}
                    aria-label={`Delete layout ${l.name}`}
                    onClick={() => {
                      padLayouts()
                        .remove(l.id)
                        .then(refresh)
                        .catch(() => refresh());
                    }}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
