/**
 * The OVERLAY section of the settings panel — data-driven by the overlay element
 * registry, so adding an overlay element makes its controls appear here automatically.
 */
import { OVERLAY_ELEMENTS, OVERLAY_CATEGORIES, type OverlayDialParams } from '@/nodes/output/canvas_overlay';
import { controlsForSurface, type OverlayControlDesc } from '../../overlayControls';
import { dispatchDialSetIn } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { CollapsibleSection, Toggle, selectCls } from '../primitives';

/**
 * Overlay settings, DATA-DRIVEN by the element categories: a collapsible section
 * per {@link OVERLAY_CATEGORIES} entry (Input features / Output features / Guides /
 * Backdrop — the "target space of the mapping" framing), and within each, one
 * control per element whose {@link OVERLAY_ELEMENTS}.category matches, rendered
 * from its {@link OVERLAY_CONTROLS} descriptor. Adding an overlay element makes it
 * appear here automatically (a test enforces every element has a descriptor), so
 * this is a general framework, not a hand-maintained list.
 *
 * `overlay` is one whole-object dial, so it has no per-dial `set` command. Its discrete
 * controls address a single scalar LEAF by path (`overlay.landmarks.show`) and dispatch
 * `dial.setIn` — the merge + validation happen inside the command. The one `alpha`-style
 * slider keeps a direct merged write (Decision B).
 *
 * Only the descriptors whose home is the INSTRUMENT are rendered here. An element can
 * declare another surface as its home — the Feature Lab does (#136), because it is a
 * tool for measuring the instrument rather than a property of it, and belongs in the
 * shell where a player can find it. See {@link OverlaySurface}.
 */
export function OverlayControls() {
  const { state, set } = useDialsSettings();
  const overlay = state.effective['overlay'] as OverlayDialParams;
  const faceActive = state.effective['face.mapping'] !== 'none';
  const categoryOf = new Map(OVERLAY_ELEMENTS.map((e) => [e.name, e.category]));
  const ours = controlsForSurface('instrument');
  // `name` is a descriptor key, which is typed over the NODE's overlay params (a
  // superset of the dial's — the Lab element lives only on the node side). `ours`
  // filters it down to the dial's keys at runtime, and `dial.setIn` refuses any path
  // that is not a declared leaf of the dial, so a stray descriptor can't write garbage.

  /** A DISCRETE element edit (a toggle / a position select) — through the registry. */
  const setElement = (name: string, field: string, value: unknown) =>
    dispatchDialSetIn(`overlay.${name}.${field}`, value);

  /** A CONTINUOUS element edit (a slider being dragged) — a direct merged write. Decision
   *  B: a write per pointer-move frame must not pay for dispatch. The ONLY sanctioned
   *  direct writer in this panel. */
  const setElementLive = (name: string, field: string, value: number) =>
    set('overlay', { ...overlay, [name]: { ...(overlay[name as keyof OverlayDialParams] as object), [field]: value } });

  const renderControl = (d: OverlayControlDesc) => {
    const elt = overlay[d.name as keyof OverlayDialParams] as { show: boolean } & Record<string, unknown>;
    const off = !!d.needsFace && !faceActive;
    return (
      <div key={d.name} className="space-y-1.5">
        <Toggle label={d.label} checked={elt.show} onChange={(v) => setElement(d.name, 'show', v)} disabled={off} />
        {off && (
          <p className="pl-5 text-[10px] leading-relaxed text-white/30">Appears once a face mapping is on.</p>
        )}
        {d.toggles?.map((t) => (
          <div key={t.key} className="pl-5">
            <Toggle
              label={t.label}
              checked={elt[t.key] as boolean}
              onChange={(v) => setElement(d.name, t.key, v)}
              disabled={off || !elt.show}
            />
          </div>
        ))}
        {d.slider && (
          <label className={`flex items-center justify-between gap-2 pl-5 text-xs ${elt.show ? '' : 'opacity-40'}`}>
            {d.slider.label}
            <input
              type="range" min={0} max={1} step={0.01}
              value={elt[d.slider.key] as number}
              disabled={!elt.show}
              onChange={(e) => setElementLive(d.name, d.slider!.key, Number(e.target.value))}
            />
          </label>
        )}
        {d.position && (
          <label className={`flex items-center justify-between gap-2 pl-5 text-xs ${elt.show ? '' : 'opacity-40'}`}>
            Position
            <select
              className={selectCls}
              value={elt.position as string}
              disabled={!elt.show}
              onChange={(e) => setElement(d.name, 'position', e.target.value)}
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {OVERLAY_CATEGORIES.map((cat) => {
        const descs = ours.filter((d) => categoryOf.get(d.name) === cat.id);
        if (descs.length === 0) return null;
        return (
          <CollapsibleSection key={cat.id} label={cat.label} defaultOpen={cat.id !== 'backdrop'}>
            {descs.map(renderControl)}
          </CollapsibleSection>
        );
      })}
    </div>
  );
}
