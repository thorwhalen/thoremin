/**
 * LabPanel — the Feature Instrumentation Lab's own surface in the app shell (#136).
 *
 * Lives here and not under `lab/` on purpose: `src/app/lab` is inside the strict DAG
 * typecheck project (tsconfig.dag.json), which ships no @types/react — the files under
 * it are the framework-agnostic lab pieces (the view schema + store). A React component
 * there breaks that typecheck.
 *
 * The Lab (#119) was built, merged and deployed, and then nobody could find it: it had
 * no entry point, it defaulted to off, and its controls were buried inside the
 * per-instrument settings editor — a *measuring* tool filed under the thing it measures.
 * This panel is its home: opened from the tools bar, closable, and (unlike a dial) it
 * never marks an instrument dirty.
 *
 * It opens on an INTRO state rather than a wall of checkboxes, because "248 normalized
 * meters" means nothing to someone who has not read the design doc. Starting the meters
 * is one click from there.
 */
import { FlaskConical, X } from 'lucide-react';
import { useControls } from './store';
import { useTools } from './toolsStore';
import { toolById } from './tools';
import { ALL_FEATURES } from '@/features/catalog';
import { labWantsFace } from '@/features/labConfig';
import { useFaceStatus } from './faceStatus';
import LabControls from './LabControls';

const TOOL_ID = 'lab';

/** What the Lab is, in the words of someone who has never seen it. Shown until the
 *  meters are running, and reachable again by turning them off. */
function LabIntro({ onStart }: { onStart: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed text-white/60">
        Thoremin plays from <span className="text-white/90">{ALL_FEATURES.length} raw features</span> it
        extracts from your face and hands every frame — how open your mouth is, how far your
        fingers are spread, where your head is pointing. The Lab draws them as live meters so
        you can see what the instrument is actually reading from you.
      </p>
      <p className="text-[11px] leading-relaxed text-white/60">
        Every feature is on a different natural scale, so each meter is{' '}
        <span className="text-white/90">normalized online</span> against the range that feature has
        actually taken since you started: a full bar means &ldquo;high for you, today&rdquo;, not
        &ldquo;high on some absolute scale&rdquo;. That is what makes a brow-raise and a finger-spread
        comparable at a glance. You can also combine features into your own{' '}
        <span className="text-white/90">derived</span> meters with a formula.
      </p>
      <p className="text-[11px] leading-relaxed text-white/40">
        The meters draw over the video, and measuring changes nothing about how the instrument
        sounds — turning on a face meter loads the face model but does not put your face in
        charge of the audio.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-black transition hover:brightness-110"
      >
        Start measuring
      </button>
    </div>
  );
}

/** A one-line status for the face half of the Lab: the meters need the face model, which
 *  the Lab itself now requests (see `faceActive`) — so the honest thing to report is the
 *  LOAD, not a "turn on face mapping" instruction the player no longer needs to follow. */
function FaceModelNote() {
  const featureLab = useControls((s) => s.featureLab);
  const phase = useFaceStatus((s) => s.status.phase);
  if (!labWantsFace(featureLab)) return null;
  if (phase === 'ready') return null;
  const text =
    phase === 'error'
      ? 'The face model failed to load — the face meters will stay empty.'
      : 'Loading the face model for the face meters…';
  return (
    <p className={`text-[10px] ${phase === 'error' ? 'text-rose-300/80' : 'text-white/40'}`}>{text}</p>
  );
}

export default function LabPanel() {
  const open = useTools((s) => s.open) === TOOL_ID;
  const close = useTools((s) => s.close);
  const featureLab = useControls((s) => s.featureLab);
  const setFeatureLab = useControls((s) => s.setFeatureLab);
  if (!open) return null;

  const tool = toolById(TOOL_ID);

  return (
    <div className="absolute bottom-14 left-3 z-40 flex max-h-[calc(100dvh-5rem)] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">
          Feature Lab
        </span>
        <button
          onClick={close}
          aria-label="Close the Feature Lab"
          className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 overflow-auto p-4">
        {tool && <p className="text-[10px] uppercase tracking-widest text-emerald-500/70">{tool.description}</p>}
        {featureLab.show ? (
          <>
            <FaceModelNote />
            <LabControls />
          </>
        ) : (
          <LabIntro onStart={() => setFeatureLab({ show: true })} />
        )}
      </div>
    </div>
  );
}
