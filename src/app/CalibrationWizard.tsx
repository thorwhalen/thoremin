/**
 * CalibrationWizard — a guided per-DEVICE calibration of the facial-expression
 * detector. Facial production varies enormously between people (and MediaPipe
 * under-reports several channels), so a fixed default firing bar can't be optimal for
 * everyone. This wizard measures, for each emotion, how much the player can actually
 * activate it, and sets that emotion's firing bar between their resting face and their
 * achievable peak — so a subsequent production reliably fires while a resting face
 * stays neutral.
 *
 * It reuses the existing machinery: the live per-emotion activations come from
 * `useFaceStatus.scores` (bridged from the DAG's `face-expression` output), and the
 * result is stored as `faceCalibration` (a per-emotion sensitivity override that wins
 * over every instrument's `faceExpr.sensitivity`, so calibration is global). The pure
 * solve is {@link calibrateSensitivity}.
 */
import { useEffect, useRef, useState } from 'react';
import { EMOTIONS, calibrateSensitivity, type Emotion } from '@/music/expression';
import { EXPRESSION_HELP } from '@/app/expressionHelp';
import { useFaceStatus } from '@/app/faceStatus';
import { useControls } from '@/app/store';

const CAPTURE_MS = 2500;
const BASELINE_MS = 2000;
const SAMPLE_MS = 80;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const keyActionOf = (e: Emotion) => EXPRESSION_HELP.find((h) => h.name === e)?.keyAction ?? '';
const isHard = (e: Emotion) => !!EXPRESSION_HELP.find((h) => h.name === e)?.hardToDetect;

/** Step model: -2 intro · -1 neutral baseline · 0..N-1 each emotion · N summary. */
const INTRO = -2;
const BASELINE = -1;
const SUMMARY = EMOTIONS.length;

export function CalibrationWizard({ onClose }: { onClose: () => void }) {
  const scores = useFaceStatus((s) => s.scores);
  const faceStatus = useFaceStatus((s) => s.status);
  const faceMapping = useControls((s) => s.faceMapping);
  const setFaceMapping = useControls((s) => s.setFaceMapping);
  const setFaceCalibration = useControls((s) => s.setFaceCalibration);

  const [step, setStep] = useState(INTRO);
  const [rest, setRest] = useState<number[]>(() => EMOTIONS.map(() => 0));
  const [peak, setPeak] = useState<number[]>(() => EMOTIONS.map(() => 0));
  const [capturing, setCapturing] = useState(false);
  const [progress, setProgress] = useState(0);
  const captureRef = useRef<{ max: number[]; acc: number[]; n: number }>({ max: [], acc: [], n: 0 });

  // The detector must be running to read activations. Turn on chord mode on entry if
  // the face is off (calibration is for the expression→chord feature), and restore it
  // on close only if we were the one who turned it on.
  const enabledByUs = useRef(false);
  useEffect(() => {
    if (faceMapping === 'none') {
      enabledByUs.current = true;
      setFaceMapping('chord');
    }
    return () => {
      if (enabledByUs.current) setFaceMapping('none');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const faceLive = faceStatus.phase === 'ready' && faceStatus.faceDetected;
  const modelLoading = faceStatus.phase === 'loading' || (faceMapping !== 'none' && faceStatus.phase !== 'ready');

  // The capture loop: sample the live scores at SAMPLE_MS, tracking per-emotion peak
  // (and, for the baseline, the running mean) until the window elapses, then commit.
  useEffect(() => {
    if (!capturing) return;
    const duration = step === BASELINE ? BASELINE_MS : CAPTURE_MS;
    const startedTick = { done: false };
    captureRef.current = { max: EMOTIONS.map(() => 0), acc: EMOTIONS.map(() => 0), n: 0 };
    let elapsed = 0;
    const id = setInterval(() => {
      const live = useFaceStatus.getState().scores;
      const c = captureRef.current;
      if (live) {
        for (let i = 0; i < EMOTIONS.length; i++) {
          const v = live[i] ?? 0;
          if (v > c.max[i]) c.max[i] = v;
          c.acc[i] += v;
        }
        c.n += 1;
      }
      elapsed += SAMPLE_MS;
      setProgress(Math.min(1, elapsed / duration));
      if (elapsed >= duration && !startedTick.done) {
        startedTick.done = true;
        clearInterval(id);
        const c2 = captureRef.current;
        setCapturing(false);
        setProgress(0);
        // The face dropped for the whole window (a race after the button enabled) —
        // don't commit a bogus zero baseline/peak or advance; let the user retry.
        if (c2.n < 3) return;
        if (step === BASELINE) {
          setRest(c2.acc.map((a) => a / c2.n));
        } else {
          setPeak((prev) => {
            const next = [...prev];
            next[step] = c2.max[step];
            return next;
          });
        }
        setStep((s) => s + 1);
      }
    }, SAMPLE_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, step]);

  const restRecord = () => Object.fromEntries(EMOTIONS.map((e, i) => [e, rest[i]])) as Record<Emotion, number>;
  const peakRecord = () => Object.fromEntries(EMOTIONS.map((e, i) => [e, peak[i]])) as Record<Emotion, number>;

  const applyAndClose = () => {
    const cal = calibrateSensitivity(restRecord(), peakRecord());
    // Only override the emotions we could actually MEASURE — the rest fall through to
    // the per-instrument sliders (don't pin an unreachable/skipped emotion to a
    // build-time default and shadow the user's own slider). No reachable → clear.
    const entries = EMOTIONS.filter((e) => cal[e].reachable).map((e) => [e, cal[e].sensitivity] as const);
    setFaceCalibration(entries.length ? Object.fromEntries(entries) : null);
    onClose();
  };

  const targetEmotion = step >= 0 && step < EMOTIONS.length ? EMOTIONS[step] : null;
  const liveScore = targetEmotion ? (scores?.[step] ?? 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-6 text-white shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Calibrate expressions</h2>
          <button className="text-white/50 hover:text-white" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!faceLive && step !== SUMMARY && (
          <p className="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            {modelLoading ? 'Loading the face model…' : 'Position your face in the camera view to continue.'}
          </p>
        )}

        {step === INTRO && (
          <div className="space-y-4 text-sm text-white/80">
            <p>
              Facial expressions read differently on every face. This sets each expression&apos;s trigger point to what
              <em> you </em> can actually produce, so the hard ones become reliable. It takes about a minute.
            </p>
            <p className="text-xs text-white/50">
              You&apos;ll rest your face once, then make each expression when prompted. Your calibration applies to every
              instrument and is saved on this device.
            </p>
            <div className="flex justify-end gap-2">
              <button className="rounded-lg px-3 py-1.5 text-sm text-white/60 hover:text-white" onClick={onClose}>
                Cancel
              </button>
              <button
                className="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-medium text-black hover:bg-emerald-400"
                onClick={() => setStep(BASELINE)}
              >
                Start
              </button>
            </div>
          </div>
        )}

        {step === BASELINE && (
          <div className="space-y-4 text-sm text-white/80">
            <p className="text-base font-medium text-white">Relax — neutral face</p>
            <p>Let your face rest naturally. Don&apos;t smile or frown. I&apos;ll measure your baseline.</p>
            <CaptureControl
              capturing={capturing}
              progress={progress}
              faceLive={faceLive}
              label="Capture baseline"
              onCapture={() => setCapturing(true)}
            />
          </div>
        )}

        {targetEmotion && (
          <div className="space-y-3 text-sm text-white/80">
            <p className="text-xs text-white/40">
              Expression {step + 1} of {EMOTIONS.length}
            </p>
            <p className="text-base font-medium text-white">
              {cap(targetEmotion)} {isHard(targetEmotion) && <span className="text-amber-300">(harder to detect)</span>}
            </p>
            <p>{keyActionOf(targetEmotion)}</p>
            <Meter value={liveScore} threshold={rest[step]} />
            <CaptureControl
              capturing={capturing}
              progress={progress}
              faceLive={faceLive}
              label={peak[step] > 0 ? 'Recapture' : 'Hold it, then capture'}
              onCapture={() => setCapturing(true)}
            />
            <div className="flex justify-between">
              <button
                className="rounded-lg px-2 py-1 text-xs text-white/50 hover:text-white disabled:opacity-30"
                onClick={() => setStep((s) => s - 1)}
                disabled={capturing}
              >
                ← Back
              </button>
              <button
                className="rounded-lg px-2 py-1 text-xs text-white/50 hover:text-white disabled:opacity-30"
                onClick={() => setStep((s) => s + 1)}
                disabled={capturing}
              >
                Skip →
              </button>
            </div>
          </div>
        )}

        {step === SUMMARY && (
          <Summary
            rest={restRecord()}
            peak={peakRecord()}
            onApply={applyAndClose}
            onCancel={onClose}
            onRedo={() => {
              setPeak(EMOTIONS.map(() => 0));
              setStep(BASELINE);
            }}
          />
        )}
      </div>
    </div>
  );
}

/** A capture button that shows an in-progress fill while the window runs. */
function CaptureControl({
  capturing,
  progress,
  faceLive,
  label,
  onCapture,
}: {
  capturing: boolean;
  progress: number;
  faceLive: boolean;
  label: string;
  onCapture: () => void;
}) {
  return (
    <button
      className="relative w-full overflow-hidden rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onCapture}
      disabled={capturing || !faceLive}
    >
      {capturing && (
        <span
          className="absolute inset-y-0 left-0 bg-black/25"
          style={{ width: `${Math.round(progress * 100)}%` }}
          aria-hidden
        />
      )}
      <span className="relative">{capturing ? 'Hold the face…' : label}</span>
    </button>
  );
}

/** A live activation meter with a marker at the current firing baseline. */
function Meter({ value, threshold }: { value: number; threshold: number }) {
  return (
    <div className="relative h-3 w-full rounded-full bg-white/10">
      <div
        className="h-3 rounded-full bg-emerald-400 transition-[width] duration-75"
        style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }}
      />
      <div
        className="absolute top-[-2px] h-[16px] w-[2px] bg-white/70"
        style={{ left: `${Math.round(Math.min(1, threshold) * 100)}%` }}
        aria-hidden
      />
    </div>
  );
}

/** The end summary: which expressions calibrated cleanly (peak cleared rest). */
function Summary({
  rest,
  peak,
  onApply,
  onCancel,
  onRedo,
}: {
  rest: Record<Emotion, number>;
  peak: Record<Emotion, number>;
  onApply: () => void;
  onCancel: () => void;
  onRedo: () => void;
}) {
  const cal = calibrateSensitivity(rest, peak);
  const reached = EMOTIONS.filter((e) => cal[e].reachable);
  return (
    <div className="space-y-3 text-sm text-white/80">
      <p className="text-base font-medium text-white">Calibration ready</p>
      <ul className="space-y-1">
        {EMOTIONS.map((e) => (
          <li key={e} className="flex items-center justify-between">
            <span>{cap(e)}</span>
            <span className={cal[e].reachable ? 'text-emerald-400' : 'text-white/40'}>
              {cal[e].reachable ? `bar ${cal[e].threshold.toFixed(2)}` : 'not detected — kept default'}
            </span>
          </li>
        ))}
      </ul>
      {reached.length < EMOTIONS.length && (
        <p className="text-xs text-white/50">
          {EMOTIONS.length - reached.length} expression(s) didn&apos;t register — the model may not read them on your
          face. You can redo those or keep the defaults.
        </p>
      )}
      <div className="flex justify-between gap-2">
        <button className="rounded-lg px-3 py-1.5 text-sm text-white/60 hover:text-white" onClick={onRedo}>
          Redo
        </button>
        <div className="flex gap-2">
          <button className="rounded-lg px-3 py-1.5 text-sm text-white/60 hover:text-white" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-medium text-black hover:bg-emerald-400"
            onClick={onApply}
          >
            Save calibration
          </button>
        </div>
      </div>
    </div>
  );
}
