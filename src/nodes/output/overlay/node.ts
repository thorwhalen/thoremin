/**
 * The `canvas-overlay` node itself: the core elements plus the contributed ones, in order, and the per-tick view they draw from.
 *
 * Part of the `canvas-overlay` node (`../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { OVERLAY_CORE_INPUTS, OverlayParamsSchema, captionsPort, categoryPool, categoryPoolInputs, type CategoryPoolSizes, type OverlayParams } from '../canvas_overlay.schema';
import { adaptContributed, contributedInputs, withContributed, type ContributedElement } from '../overlay_contributions';
import type { ExpressionScores } from '@/music/expression';
import { computeTagOverlay, type TagOverlaySnapshot } from '@thoremin/taglog/presentation';
import type { HandMap } from '../../mapping/hand_map';
import type { BodyFrame, BodyStatus, CategoryScores, FaceFrame, HandFeatures, HandsFrame, SynthParams } from '@thoremin/sdk/nodes/domain';
import { pickCategories } from './elements/category';
import { OVERLAY_ELEMENTS } from './elements/index';
import { makeFrameView, type Size, type ViewOptions } from '@thoremin/sdk/view/frame_view';
import { layoutCues } from './layout';
import type { OverlayElement, OverlayView, Params } from './view';

/** Each contributed element's `drawBefore`, by element id. */
const drawBeforeOf = (contributed: readonly ContributedElement[]) => Object.fromEntries(contributed.map((c) => [c.id, c.decl.drawBefore]));

/** The draw (z) order of the core elements with `contributed` in place, by element name. */
export function overlayElementOrder(contributed: readonly ContributedElement[]): string[] {
  return withContributed<OverlayElement>(OVERLAY_ELEMENTS, contributed.map((c) => adaptContributed<OverlayView>(c)), drawBeforeOf(contributed)).map((e) => e.name);
}


/**
 * The overlay node for a list of contributed elements (#600 S5): the core inputs, plus one input
 * per contributed element's input (its generated port), decided once, when the registry is built
 * (`src/nodes/browser.ts`), like `store-controls`' ports. With none it is the core overlay.
 */
export function makeCanvasOverlayNode(contributed: readonly ContributedElement[] = [], categoryPools: CategoryPoolSizes = { classifier: 0, categorizer: 0 }) {
  // A `drawBefore` naming no core element would silently fall back to the default slot.
  for (const c of contributed) {
    const target = c.decl.drawBefore;
    if (target !== undefined && !OVERLAY_ELEMENTS.some((e) => e.name === target)) throw new Error(`overlay element "${c.id}" draws before "${target}", which is not a core overlay element`);
  }
  const adapted = contributed.map((c) => adaptContributed<OverlayView>(c));
  const ALL_ELEMENTS = withContributed<OverlayElement>(OVERLAY_ELEMENTS, adapted, drawBeforeOf(contributed));
  const ALL_NAMES: ReadonlySet<string> = new Set(ALL_ELEMENTS.map((e) => e.name));
  const contributedPorts = contributed.flatMap((c) => Object.entries(c.ports).map(([input, port]) => ({ name: port, kind: c.kinds[input] })));
  // The category pools (#600 S10b): the composer allocates a slot per reader a branch declares.
  const classifierSlots = categoryPool('classifier', categoryPools.classifier);
  const categorizerSlots = categoryPool('categorizer', categoryPools.categorizer);
  return defineNode<Params>({
    type: 'canvas-overlay',
    roles: ['overlay'],
    title: 'Canvas Overlay',
    description: 'Mirrored video + composable overlay elements (guides, landmarks, markers, cues), and the elements extensions contribute.',
    inputs: [...OVERLAY_CORE_INPUTS, ...categoryPoolInputs(categoryPools), ...contributedPorts],
    outputs: [],
    params: OverlayParamsSchema,
    make(p) {
      // The contributed elements' state belongs to THIS overlay instance (#600 S10); the Feature
      // Lab's statistics live in its element's (the Lab slice's, #600 S16b).
      const elementState: Record<string, { memo: Record<string, unknown>; broken: boolean }> = {};

      return {
        process(inputs, ctx: NodeContext) {
          const canvas = ctx.resources.canvas as HTMLCanvasElement | undefined;
          const video = ctx.resources.video as HTMLVideoElement | undefined;
          if (!canvas) return {};
          const g = canvas.getContext('2d');
          if (!g) return {};

          const W = canvas.width;
          const H = canvas.height;
          g.clearRect(0, 0, W, H);

          // Live control store: the hand map (note source + finger routing) and the
          // expression→degree map, so cues reflect the ACTUAL mapping. Read like
          // voice-mapping (ctx.resources.controls); absent in headless tests.
          const controls = (
            ctx.resources.controls as
              | (() => {
                  handMap?: HandMap;
                  faceExpr?: { degrees?: Record<string, number>; targets?: Record<string, string> };
                  faceMapping?: string;
                })
              | undefined
          )?.();

          // Burned-in tag HUD (#92): read the runtime snapshot (null unless a take is
          // recording) and derive this tick's frame from the engine clock. A no-op
          // resource means frame === null and the tagHud element draws nothing.
          const tagOverlayFn = ctx.resources.tagOverlay as (() => TagOverlaySnapshot | null) | undefined;
          const tagOverlay = computeTagOverlay(tagOverlayFn?.() ?? null, ctx.time);

          // How the host shows the canvas (`ctx.resources.display`, #817): not a player setting, since
          // only the code that sizes the canvas knows it. Absent = stretched and mirrored, as always.
          const display = ctx.resources.display as ViewOptions | undefined;
          const hands = inputs.hands as HandsFrame | undefined;
          const frameSize: Size | undefined = video?.videoWidth ? { width: video.videoWidth, height: video.videoHeight } : hands ? { width: hands.width, height: hands.height } : undefined;

          const liveConfig = inputs.overlayConfig as OverlayParams | undefined;
          const view: OverlayView = {
            W,
            H,
            frame: makeFrameView({ width: W, height: H }, frameSize, display),
            t: ctx.time,
            elementState,
            video,
            params: liveConfig ?? p,
            layout: {},
            inputs: {
              hands: inputs.hands as HandsFrame | undefined,
              features: inputs.features as HandFeatures | undefined,
              params: inputs.params as SynthParams | undefined,
              scale: inputs.scale as number[] | undefined,
              scaleLeft: inputs.scaleLeft as number[] | undefined,
              chordScale: inputs.chordScale as number[] | undefined,
              octaveShift: typeof inputs.octaveShift === 'number' ? inputs.octaveShift : 0,
              chord: inputs.chord as number[] | undefined,
              faceFrame: inputs.faceFrame as FaceFrame | undefined,
              bodyFrame: inputs.bodyFrame as BodyFrame | undefined,
              bodyStatus: inputs.bodyStatus as BodyStatus | undefined,
              expression: inputs.expression as ExpressionScores | undefined,
              handMap: controls?.handMap,
              faceDegrees: controls?.faceExpr?.degrees,
            faceTargets: controls?.faceExpr?.targets,
              categoryDegrees: inputs.categoryDegrees as Record<string, number> | undefined,
              categoryTargets: inputs.categoryTargets as Record<string, string> | undefined,
              faceMapping: controls?.faceMapping,
              tagOverlay,
              ...pickCategories(
                classifierSlots.map((slot) => ({ scores: inputs[slot] as CategoryScores | null | undefined, captions: inputs[captionsPort(slot)] as readonly string[] | null | undefined })),
                categorizerSlots.map((slot) => ({ scores: inputs[slot] as CategoryScores | null | undefined })),
              ),
            },
          };
          let drawn: ReadonlySet<string> = ALL_NAMES;
          if (Array.isArray(inputs.elements)) {
            const wanted = new Set(inputs.elements as string[]);
            view.elements = ALL_ELEMENTS.filter((e) => wanted.has(e.name));
            drawn = wanted;
          } else if (adapted.length) view.elements = ALL_ELEMENTS;
          const elements = view.elements ?? OVERLAY_ELEMENTS;
          if (contributed.length) view.contributed = contributedInputs(contributed, drawn, inputs);

          // A contributed element's per-tick work (#600 S16b), once, before either pass draws.
          for (const element of elements) element.update?.(view);
          view.layout = layoutCues(view);
          for (const element of elements) element.draw(g, view);

          // Overlay-only (alpha) pass (#88): when a transparent overlay canvas is
          // injected via resources (only while the overlay-alpha stream is being
          // recorded — Chromium alpha-WebM), redraw the SAME elements onto it with
          // the webcam backdrop suppressed, so the landmarks/cues sit on
          // transparency. Reuses the exact element draw list (no duplicated drawing
          // logic, no drift) and is a no-op — zero cost — whenever the resource is
          // absent (i.e. always, except during an alpha take).
          const alphaCanvas = ctx.resources.overlayAlphaCanvas as HTMLCanvasElement | undefined;
          if (alphaCanvas) {
            const ga = alphaCanvas.getContext('2d');
            if (ga) {
              ga.clearRect(0, 0, alphaCanvas.width, alphaCanvas.height);
              const alphaView: OverlayView = {
                ...view,
                W: alphaCanvas.width,
                H: alphaCanvas.height,
                frame: makeFrameView({ width: alphaCanvas.width, height: alphaCanvas.height }, frameSize, display),
                params: { ...view.params, video: { ...view.params.video, show: false } },
              overlayOnly: true,
              };
              // Its own cue layout: the alpha canvas may differ in size from the main one.
              alphaView.layout = layoutCues(alphaView);
              for (const element of elements) element.draw(ga, alphaView);
            }
          }

          return {};
        },
      };
    },
  });
}

/** The core overlay (no contributed element): the core node library's. */
export const canvasOverlayNode = makeCanvasOverlayNode();
