/**
 * The OVERLAY section of the settings panel — data-driven by the overlay element
 * registry, so adding an overlay element makes its controls appear here automatically.
 */
import { OVERLAY_ELEMENTS, OVERLAY_CATEGORIES, type OverlayParams } from '@/nodes/output/canvas_overlay';
import { OVERLAY_CONTROLS, type OverlayControlDesc } from '../../overlayControls';
import { useDialsSettings } from '../useDialsSettings';
import { CollapsibleSection, Toggle, selectCls } from '../primitives';

/**
 * Overlay settings, DATA-DRIVEN by the element categories: a collapsible section
 * per {@link OVERLAY_CATEGORIES} entry (Input features / Output features / Guides /
 * Backdrop — the "target space of the mapping" framing), and within each, one
 * control per element whose {@link OVERLAY_ELEMENTS}.category matches, rendered
 * from its {@link OVERLAY_CONTROLS} descriptor. Adding an overlay element makes it
 * appear here automatically (a test enforces every element has a descriptor), so
 * this is a general framework, not a hand-maintained list. The whole overlay object
 * is one dial value; each edit writes a merged copy back.
 */
export function OverlayControls() {
  const { state, set } = useDialsSettings();
  const overlay = state.effective['overlay'] as OverlayParams;
  const faceActive = state.effective['face.mapping'] !== 'none';
  const categoryOf = new Map(OVERLAY_ELEMENTS.map((e) => [e.name, e.category]));
  const patch = (name: keyof OverlayParams, p: object) =>
    set('overlay', { ...overlay, [name]: { ...(overlay[name] as object), ...p } });

  const renderControl = (d: OverlayControlDesc) => {
    const elt = overlay[d.name] as { show: boolean } & Record<string, unknown>;
    const off = !!d.needsFace && !faceActive;
    return (
      <div key={d.name} className="space-y-1.5">
        <Toggle label={d.label} checked={elt.show} onChange={(v) => patch(d.name, { show: v })} disabled={off} />
        {off && (
          <p className="pl-5 text-[10px] leading-relaxed text-white/30">Appears once a face mapping is on.</p>
        )}
        {d.toggles?.map((t) => (
          <div key={t.key} className="pl-5">
            <Toggle
              label={t.label}
              checked={elt[t.key] as boolean}
              onChange={(v) => patch(d.name, { [t.key]: v })}
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
              onChange={(e) => patch(d.name, { [d.slider!.key]: Number(e.target.value) })}
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
              onChange={(e) => patch(d.name, { position: e.target.value })}
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
        const descs = OVERLAY_CONTROLS.filter((d) => categoryOf.get(d.name) === cat.id);
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
