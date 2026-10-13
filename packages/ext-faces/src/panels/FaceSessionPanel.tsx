/**
 * The face categorizer session, as a panel (#330 P2, P3): record a take of your own faces, see it
 * carved into categories with their faces, choose how many and how neutral is treated, name
 * them, and save several; open one to test it live, correct it (a face moved to another
 * category, "this face is X", more faces merged in), tune it, and export or import it as a file
 * (P3, `./TestAndTune.tsx`). The host draws the frame (`ExtensionToolPanels`); this is its content.
 *
 * Rendering only: every action is the session store's (`../app/sessionStore.ts`). Closing the
 * tool (unmounting this) stops a recording, or an exploration, so nothing keeps sampling (or
 * keeps the instrument quiet) with no panel to say so.
 *
 * #385 E4: the grid is Sorting (`./Sorting.tsx`), the same for a fresh carve and an opened
 * categorizer: every hold shown, moved by drag, keys or menu, k re-cut around the player's pins,
 * merge, split, delete, undo.
 *
 * #385 E2: "Record my faces" opens Explore (the camera read, the live feature bars and the hold
 * ring, nothing recorded); "Start capturing" (or Space) begins the take; while capturing, Pause
 * (or Space) stops collecting and the bars and ring keep running. Space is the host's
 * `carve.capture.toggle` command, through the capture seam the session store provides.
 */
import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { ExtensionToolPanelProps } from '@thoremin/sdk-ui/types';
import { FeatureBars } from '@thoremin/sdk-ui/enroll/FeatureBars';
import { HoldRing, type HoldRingState } from '@thoremin/sdk-ui/enroll/HoldRing';
import { dispatchDialPatch, useDialsSettings } from '@thoremin/sdk-ui/dials';
import type { CategorizerStrangers } from '@thoremin/sdk/enroll/categorizer';
import { faceSessionStore, faceTestStore } from '../app/faceSession';
import { isLive, type FaceSessionState } from '../app/sessionStore';
import { faceModalityUi } from '../app/modality';
import type { FaceTestState } from '../app/testStore';
import { downloadCategorizer, ImportButton, TestAndTune } from './TestAndTune';
import { restCue, vocabularyCue } from '../lib/take';
import type { SortingView } from '../lib/carving';
import { Sorting } from './Sorting';
import { chooseCategorizerWrites } from '../schema';
import { useCategorizerPlay } from '../app/categorizerPlay';

const btn = 'rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/90 transition hover:bg-white/20 disabled:opacity-40';
const primary = 'rounded-md border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-40';
const hint = 'text-[11px] leading-relaxed text-white/60';

/** The strangers switch (#385 E5), stated plainly: what a face nobody taught reads as. Neutral
 *  itself is taught by example (the Neutral bin) in both settings. */
export const STRANGERS_TEXT: Record<CategorizerStrangers, { title: string; says: string }> = {
  neutral: {
    title: 'Neutral',
    says: 'A face far from every category you made reads as none of these, as your Neutral faces do.',
  },
  nearest: {
    title: 'The nearest face',
    says: 'A face you never taught reads as whichever of your categories it is closest to (or Neutral, when it is closer to your Neutral faces).',
  },
};

/** One line saying what k counts and what Neutral holds. */
export function strangersSummary(view: SortingView): string {
  const held = view.neutral.count === 1 ? '1 held face' : `${view.neutral.count} held faces`;
  const neutral = !view.neutralTrained
    ? `Neutral (${held}) is not trained on: this categorizer was made before Neutral was taught.`
    : view.neutralKnown || view.neutral.count > 0
      ? `Neutral (${held}) plays nothing.`
      : 'There was no rest to tell neutral by, so Neutral is empty: drag your resting faces into it.';
  return `${view.k} expressions. ${neutral}`;
}

function StrangersSwitch({ strangers, setStrangers }: { strangers: CategorizerStrangers; setStrangers: (m: CategorizerStrangers) => void }) {
  return (
    <fieldset className="space-y-1" data-faces-strangers>
      <legend className="text-[10px] font-bold uppercase tracking-widest text-white/50">A face I never taught reads as</legend>
      {(['neutral', 'nearest'] as const).map((m) => (
        <label key={m} className={`flex cursor-pointer gap-2 rounded-md border p-1.5 ${strangers === m ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10'}`}>
          <input type="radio" name="faces-strangers" value={m} checked={strangers === m} onChange={() => setStrangers(m)} className="mt-0.5" />
          <span>
            <span className="block text-[11px] font-semibold text-white/90">{STRANGERS_TEXT[m].title}</span>
            <span className="block text-[10px] leading-snug text-white/55">{STRANGERS_TEXT[m].says}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Grid({ s, session, test }: { s: FaceSessionState; session: StoreApi<FaceSessionState>; test: StoreApi<FaceTestState> }) {
  const view = s.view!;
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name]);
  return (
    <div className="space-y-3">
      <StrangersSwitch strangers={view.strangers} setStrangers={s.setStrangers} />
      <p data-faces-summary className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-white/80">
        <span className="font-semibold text-emerald-200">A face you never taught reads as: {STRANGERS_TEXT[view.strangers].title.toLowerCase()}.</span> {strangersSummary(view)}
      </p>
      {!s.hasStills && <p className={hint}>No pictures were taken, so the categories have none.</p>}
      <Sorting s={s} />
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void s.save(name);
        }}
      >
        <input
          aria-label="Categorizer name"
          placeholder="Name this categorizer"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-xs text-white outline-none focus:bg-white/20"
        />
        <button type="submit" className={primary} disabled={!name.trim() || s.saving || view.k === 0}>
          Save
        </button>
        {s.phase === 'carved' && (
          <button
            type="button"
            className={btn}
            disabled={view.k === 0}
            title="Save this carve as a file, before or without saving it here (no pictures)"
            onClick={() => downloadCategorizer(s.exportFile(name))}
          >
            Export file
          </button>
        )}
      </form>
      {s.dirty && (
        <p className="text-[10px] text-amber-200/80" data-faces-unsaved>
          Not saved yet.
        </p>
      )}
      {s.phase === 'saved' && <TestAndTune session={session} test={test} />}
    </div>
  );
}

/**
 * "Play it" (#357): the current instrument reads this categorizer, the same one `dial.patch` the
 * editor's Face categorizer section dispatches (every category's chord back to Auto, the face
 * chords on if the face played nothing). The instrument is left unsaved, as with any edit. Once
 * the instrument names it, the button says so instead: choosing it again would only put the
 * chords the player picked back to Auto.
 */
function PlayButton({ id, name, unsaved }: { id: string; name: string; unsaved: boolean }) {
  const { state } = useDialsSettings();
  const play = useCategorizerPlay();
  const v = state.effective as Record<string, unknown>;
  const faceMapping = String(v['face.mapping'] ?? 'none');
  const chosen = (v.faceCategorizer as { id?: string } | undefined)?.id === id;
  // The instrument plays what is SAVED: say so while the grid shows an unsaved edit of this one.
  const note = unsaved ? ' (the saved version)' : '';
  if (chosen) {
    // "Playing" only once the model is resolved for the instrument, not merely named by it.
    const text = faceMapping !== 'chord' ? 'Chosen (face chords off)' : play.id === id && play.phase === 'ready' ? `Playing${note}` : 'Loading…';
    return (
      <span className="shrink-0 text-[10px] text-emerald-300/80" data-faces-playing={id}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={btn}
      aria-label={`Play ${name}`}
      title={`The current instrument's face chords read this one${note} (unsaved, like any edit)`}
      onClick={() => dispatchDialPatch(chooseCategorizerWrites(id, faceMapping))}
    >
      Play it
    </button>
  );
}

function SavedList({ s, confirmDiscard }: { s: FaceSessionState; confirmDiscard: () => boolean }) {
  if (s.saved.length === 0) return <p className={hint}>No saved categorizers yet.</p>;
  return (
    <ul className="space-y-1" data-faces-saved>
      {s.saved.map((m) => (
        <li key={m.id} className={`flex items-center gap-2 rounded px-1.5 py-1 text-[11px] ${s.openId === m.id ? 'bg-emerald-500/10' : ''}`}>
          <span className="min-w-0 flex-1 truncate text-white/85">{m.name}</span>
          <span className="shrink-0 text-[10px] text-white/40">{new Date(m.createdAt).toLocaleDateString()}</span>
          <button type="button" className={btn} aria-label={`Open ${m.name}`} onClick={() => confirmDiscard() && void s.open(m.id)}>
            Open
          </button>
          <PlayButton id={m.id} name={m.name} unsaved={s.openId === m.id && s.dirty} />
          <button type="button" className={btn} aria-label={`Export ${m.name} as a file`} title="Save it as a file, as saved (no pictures)" onClick={() => void s.exportSaved(m.id).then(downloadCategorizer)}>
            Export
          </button>
          <button
            type="button"
            className={btn}
            aria-label={`Delete ${m.name}`}
            onClick={() => {
              if (window.confirm(`Delete "${m.name}"? This cannot be undone.`)) void s.remove(m.id);
            }}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}

const { modality } = faceModalityUi;

/** The hold ring's words, per phase: what a hold does now. */
function ringWords(phase: 'explore' | 'faces' | 'paused'): Record<HoldRingState, string> {
  const { one } = modality.words;
  const latched = `Move to a new ${one} first.`;
  if (phase === 'faces') return { open: `Hold a ${one} until the ring closes.`, settling: 'Holding…', taken: `Taken. Move to a new ${one}.`, latched };
  if (phase === 'paused') return { open: 'Paused: a hold now is not taken.', settling: 'Holding… (paused)', taken: 'Held: it would have been taken, if not paused.', latched };
  return { open: `Hold a ${one}: the ring closes when it would be taken.`, settling: 'Holding…', taken: `Held: that one would be taken. Try a new ${one}.`, latched };
}

const STATE_TEXT: Record<'explore' | 'rest' | 'faces' | 'paused', string> = {
  explore: 'Exploring',
  rest: 'Resting',
  faces: 'Capturing',
  paused: 'Paused',
};

/** Explore, the rest, Capturing and Paused: one screen (design C.3.1). */
function LiveTake({ s, store }: { s: FaceSessionState; store: StoreApi<FaceSessionState> }) {
  const phase = s.phase as 'explore' | 'rest' | 'faces' | 'paused';
  const { one, many } = modality.words;
  const read = useCallback((o: { count: number }) => store.getState().live(o), [store]);
  const cue = phase === 'rest' ? restCue(modality) : vocabularyCue(modality);
  const instruction =
    phase === 'explore'
      ? `Try your ${many}: the bars show what the camera reads, and the ring when a ${one} is held. Nothing is recorded yet.`
      : phase === 'paused'
        ? `Paused: nothing is recorded. Rehearse the next ${one}, then resume.`
        : cue.instruction;
  return (
    <div className="space-y-2" data-faces-recording={phase}>
      {s.merging && <p className="text-[11px] font-semibold text-emerald-200">{`Adding to "${s.name}": ${s.merging === 'samples' ? `new ${many} join its categories` : 'its categories are learned again from this take'}.`}</p>}
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-white/70" role="status" aria-live="polite">
        <span className={`font-bold uppercase tracking-widest ${phase === 'faces' ? 'text-rose-300' : phase === 'paused' ? 'text-amber-200' : 'text-white/60'}`} data-faces-state>
          {phase === 'faces' ? '● ' : ''}
          {STATE_TEXT[phase]}
        </span>
        {phase !== 'explore' && <span>{`${s.elapsed.toFixed(0)} s`}</span>}
        {(phase === 'faces' || phase === 'paused') && <span>{`${s.points} held ${s.points === 1 ? one : many}`}</span>}
        {phase !== 'explore' && <span>{s.hasStills ? 'pictures kept in this page only' : 'no pictures'}</span>}
      </p>
      <p className="text-sm font-semibold text-white">{instruction}</p>
      {phase !== 'explore' && phase !== 'paused' && <p className={hint}>{cue.rationale}</p>}
      <div className="flex flex-wrap gap-2">
        {phase === 'explore' && (
          <button type="button" className={primary} onClick={() => s.start()}>
            Start capturing (Space)
          </button>
        )}
        {phase === 'faces' && (
          <button type="button" className={btn} onClick={() => s.pause()}>
            Pause (Space)
          </button>
        )}
        {phase === 'paused' && (
          <button type="button" className={primary} onClick={() => s.resume()}>
            Resume (Space)
          </button>
        )}
        {phase !== 'explore' && (
          <button type="button" className={primary} onClick={() => void s.stop()}>
            Stop and carve
          </button>
        )}
        <button type="button" className={btn} onClick={() => s.cancelRecording()}>
          Cancel
        </button>
      </div>
      {phase !== 'rest' && <HoldRing state={s.hold} taken={s.points} words={ringWords(phase)} />}
      <FeatureBars read={read} part={modality.words.part} one={one} />
    </div>
  );
}

export function FaceSessionView({ store, test }: { store: StoreApi<FaceSessionState>; test: StoreApi<FaceTestState> }) {
  const s = useStore(store);
  /** Whether to go on when that drops something unsaved (a carve, a correction, an import). */
  const confirmDiscard = () => !s.dirty || window.confirm('What is shown is not saved. Drop it?');
  useEffect(() => {
    void store.getState().refreshSaved();
    // Closing the tool stops a recording: nothing keeps sampling with no panel to say so.
    return () => {
      const { phase, cancelRecording } = store.getState();
      if (isLive(phase)) cancelRecording();
    };
  }, [store]);

  if (s.phase === 'stopping') {
    return (
      <p className="text-sm text-white/80" role="status" aria-live="polite" data-faces-recording="stopping">
        Carving your faces…
      </p>
    );
  }
  if (s.phase === 'explore' || s.phase === 'rest' || s.phase === 'faces' || s.phase === 'paused') return <LiveTake s={s} store={store} />;

  return (
    <div className="space-y-3">
      {s.phase === 'idle' && (
        <p className={hint}>
          Record a minute of your own faces: a few seconds of rest, then each face you want the instrument to know. They are carved into categories you can
          name and keep. First you see what the camera reads; nothing is recorded until you start. Everything stays in this browser.
        </p>
      )}
      {s.notice && (
        <p className="text-[11px] text-amber-200/90" role="status" aria-live="polite">
          {s.notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} onClick={() => confirmDiscard() && s.explore()}>
          {s.phase === 'idle' ? 'Record my faces' : 'Record a new take'}
        </button>
        {s.phase !== 'idle' && (
          <button type="button" className={btn} onClick={() => confirmDiscard() && s.reset()}>
            Close the grid
          </button>
        )}
      </div>
      {(s.phase === 'carved' || s.phase === 'saved') && s.view && <Grid s={s} session={store} test={test} />}
      <div className="space-y-1 border-t border-white/10 pt-2">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-[10px] font-bold uppercase tracking-widest text-white/50">Saved categorizers</h3>
          <ImportButton s={s} confirmDiscard={confirmDiscard} />
        </div>
        <SavedList s={s} confirmDiscard={confirmDiscard} />
      </div>
    </div>
  );
}

/** The tool's panel: the view over the page's session store (the host's frame closes it). */
export default function FaceSessionPanel(_props: ExtensionToolPanelProps) {
  return <FaceSessionView store={faceSessionStore()} test={faceTestStore()} />;
}
