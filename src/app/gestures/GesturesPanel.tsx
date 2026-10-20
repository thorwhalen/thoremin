/**
 * GesturesPanel — the shell surface for gesture dispatch (#129), opened from the
 * tools bar (the Feature Lab precedent: a TOOL, not a settings-panel section,
 * because a gesture binding is not an instrument parameter — it is a per-device
 * preference, like a keymap, and must never ride an instrument preset).
 *
 * One row per bindable gesture (fist / open palm / pinch): a live "held now"
 * indicator (from the transition-gated gestureStatus store), a command picker over
 * the registry's gesture-bindable commands, and a fixed-args JSON field (a binding
 * carries fixed params, exactly like the keyboard keymap). Plus the master enable
 * toggle and the hold / cooldown sliders.
 *
 * Confirmation-gated commands (instrument load/save/create) are ABSENT from the
 * picker by design — a hands-free flow cannot answer a confirmation dialog — and
 * the panel says so. A stale persisted binding naming a command the registry no
 * longer has is surfaced as a visible warning on its row (and refused with an
 * error toast if it ever fires).
 *
 * Above the gestures, the player's OWN categories (#160, `enroll/CategoryBindings.tsx`):
 * a category saved from the Trainer binds to a command the same way, through the same
 * picker (`CommandBindingFields`).
 *
 * All writes here go to the `gestures` tooling pref on the hot store (direct
 * `setGestures`, like the Feature Lab's `setLab`) — this panel configures
 * the DISPATCHER; it never writes a dial itself.
 */
import { Hand, X } from 'lucide-react';
import CommandBindingFields from './CommandBindingFields';
import CategoryBindings from '../enroll/CategoryBindings';
import {
  GESTURE_IDS,
  GESTURE_LABELS,
  MAX_GESTURE_COOLDOWN_MS,
  MAX_GESTURE_HOLD_MS,
  type GestureBinding,
  type GestureId,
} from './gesturePrefs';
import { useGestureStatus } from './gestureStatus';
import { useControls } from '../store';
import { useTools } from '../tools/toolsStore';
import { toolById } from '../tools/tools';

const TOOL_ID = 'gestures';

/** One gesture row: live indicator + the shared command picker / fixed-args field. */
function GestureRow({ gesture }: { gesture: GestureId }) {
  const binding = useControls((s) => s.gestures.bindings[gesture]);
  const heldNow = useGestureStatus((s) => s.poses.left === gesture || s.poses.right === gesture);

  const setBinding = (next: GestureBinding | undefined) => {
    const { gestures, setGestures } = useControls.getState();
    const bindings = { ...gestures.bindings };
    if (next) bindings[gesture] = next;
    else delete bindings[gesture];
    setGestures({ bindings });
  };

  return (
    <div className="space-y-1 rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${heldNow ? 'bg-emerald-400' : 'bg-white/15'}`}
          title={heldNow ? 'Held right now' : 'Not currently held'}
        />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">
          {GESTURE_LABELS[gesture]}
        </span>
      </div>
      <CommandBindingFields label={GESTURE_LABELS[gesture]} binding={binding} onChange={setBinding} />
    </div>
  );
}

/** A labelled millisecond slider for the hold / cooldown timing prefs. */
function MsSlider({
  label,
  value,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-[10px] uppercase tracking-widest text-white/50">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-white/70">{value} ms</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

export default function GesturesPanel() {
  const open = useTools((s) => s.open) === TOOL_ID;
  const close = useTools((s) => s.close);
  const gestures = useControls((s) => s.gestures);
  const setGestures = useControls((s) => s.setGestures);
  if (!open) return null;

  const tool = toolById(TOOL_ID);

  return (
    <div className="shell-tool-panel absolute left-3 z-40 flex w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Hand className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">Gestures</span>
        <button
          onClick={close}
          aria-label="Close the Gestures panel"
          className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 overflow-auto p-4">
        {tool && <p className="text-[10px] uppercase tracking-widest text-emerald-500/70">{tool.description}</p>}
        <CategoryBindings />
        <h3 className="border-t border-white/10 pt-3 text-[11px] font-bold uppercase tracking-widest text-white/70">Hand poses</h3>
        <p className="text-[11px] leading-relaxed text-white/60">
          Hold a pose for the hold time to fire its command once; it will not fire again until you
          release, re-enter the pose, and the cooldown has passed. Either hand can trigger a binding.
        </p>
        <label className="flex items-center gap-2 text-[11px] text-white/80">
          <input
            type="checkbox"
            aria-label="Enable gesture commands"
            checked={gestures.enabled}
            onChange={(e) => setGestures({ enabled: e.target.checked })}
          />
          Enable gesture commands
        </label>
        <MsSlider
          label="Minimum hold"
          value={gestures.holdMs}
          max={MAX_GESTURE_HOLD_MS}
          step={50}
          onChange={(v) => setGestures({ holdMs: v })}
        />
        <MsSlider
          label="Cooldown after firing"
          value={gestures.cooldownMs}
          max={MAX_GESTURE_COOLDOWN_MS}
          step={100}
          onChange={(v) => setGestures({ cooldownMs: v })}
        />
        {GESTURE_IDS.map((g) => (
          <GestureRow key={g} gesture={g} />
        ))}
        <p className="text-[10px] leading-relaxed text-white/40">
          Instrument load/save/create are not offered: they need a confirmation you cannot give
          hands-free. Commands run with the fixed args shown; an empty args field dispatches none.
        </p>

      </div>
    </div>
  );
}
