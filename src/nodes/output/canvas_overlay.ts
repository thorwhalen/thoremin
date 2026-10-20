/**
 * `canvas-overlay` node (browser-only) — the visual output + guides + cues.
 *
 * The overlay is composed of an ordered list of independent **overlay elements**
 * (see `OVERLAY_ELEMENTS`): the mirrored webcam backdrop, a per-scale-note pitch
 * guide, finger guides, hand/face landmark dots, per-hand control markers, the
 * finger→thumb effect lines, and HUD "cue" readouts (the face-expression bar graph
 * and the finger bar graph).
 *
 * Two kinds of element:
 *  - **in-scene** elements draw at a feature's location (markers on the hand, lines
 *    from fingertip to thumb, guides across the frame);
 *  - **cue** elements are HUD boxes (bar graphs) placed on a screen EDGE and
 *    auto-stacked when several share one — a cue declares `cue:true` + `measure()`
 *    + `positionOf()`, and reads its computed origin from `view.layout[name]`.
 *
 * Each element is drawn in list order (= z-order), reads only what it needs, and is
 * toggled/parameterized by its own sub-object in `Params`. This is the worked
 * example of the "sub-components are toggled functions inside one node" rule. To
 * reflect the actual mapping, elements read the live **hand map** (note source +
 * finger routing) and the expression→degree map via `ctx.resources.controls`.
 *
 * Canvas + video are injected via `ctx.resources`. Pure drawing; no port output.
 *
 * This file is the node's public face (#600 S19a): the code is in `./overlay/` (`view.ts` the
 * element contract and what each element sees, `elements/<name>.ts` one element each and
 * `elements/index.ts` their draw order, `layout.ts` the cue layout, `node.ts` the node).
 */
export { CuePositionEnum, OVERLAY_CATEGORIES, OVERLAY_ELEMENT_CATEGORIES, OverlayDialSchema, OverlayParamsSchema, TrainerHudParamsSchema } from './canvas_overlay.schema';
export type { CuePosition, OverlayCategory, OverlayDialParams, OverlayParams, TrainerHudParams } from './canvas_overlay.schema';
export type { ContributedElement } from './overlay_contributions';
export type { OverlayView, OverlayElement } from './overlay/view';
export type { CategorySlot } from './overlay/elements/category';
export { pickCategories } from './overlay/elements/category';
export { OVERLAY_ELEMENTS } from './overlay/elements/index';
export { overlayElementOrder, makeCanvasOverlayNode, canvasOverlayNode } from './overlay/node';
