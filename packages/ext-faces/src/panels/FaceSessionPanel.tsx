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
 *
 * #385 E7: while capturing or paused, a **burst** records one held face from every frame while
 * B (or the button) is held, optionally under a name typed first (a labelled hold, pinned to the
 * category of that name). Paused, bursts are the only capture: burst mode.
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
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { HAND_CHOICES, type HandChoice, type ModalityWords } from '@thoremin/sdk/enroll/modality';
import { categoryBinder } from '@thoremin/sdk-ui/enroll/binder';
import { handSessionStore, handTestStore } from '../app/handSession';
import { bodySessionStore, bodyTestStore } from '../app/bodySession';
import { WordsContext } from './words';
import type { FaceTestState } from '../app/testStore';
import { downloadCategorizer, ImportButton, TestAndTune } from './TestAndTune';
import { setupCues, vocabularyCue } from '../lib/take';
import type { SortingView } from '../lib/carving';
import { Sorting } from './Sorting';
import { chooseCategorizerWrites } from '../schema';
import { useCategorizerPlay } from '../app/categorizerPlay';

const btn = 'rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/90 transition hover:bg-white/20 disabled:opacity-40';
const primary = 'rounded-md border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-40';
const hint = 'text-[11px] leading-relaxed text-white/60';

/** The strangers switch (#385 E5), stated plainly: what a face nobody taught reads as, in the
 *  modality's words (`one`: `face`, `hand shape`). Neutral itself is taught by example (the
 *  Neutral bin) in both settings. */
export function strangersText({ one, many }: Pick<ModalityWords, 'one' | 'many'>): Record<CategorizerStrangers, { title: string; says: string }> {
  return {
    neutral: {
      title: 'Neutral',
      says: `A ${one} far from every category you made reads as none of these, as your Neutral ${many} do.`,
    },
    nearest: {
      title: `The nearest ${one}`,
      says: `A ${one} you never taught reads as whichever of your categories it is closest to (or Neutral, when it is closer to your Neutral ${many}).`,
    },
  };
}

/** The face's (#385 E5). */
export const STRANGERS_TEXT = strangersText(faceModality.words);

/** One line saying how many categories there are and what Neutral holds. */
export function strangersSummary(view: SortingView, { one, many }: Pick<ModalityWords, 'one' | 'many'> = faceModality.words): string {
  const held = view.neutral.count === 1 ? `1 held ${one}` : `${view.neutral.count} held ${many}`;
  const neutral =
    view.neutral.count === 0
      ? view.neutralKnown
        ? `Neutral is empty: drag the ${many} that should mean nothing into it.`
        : `There was no rest to tell neutral by, so Neutral is empty: drag your resting ${many} into it.`
      : view.neutralTrained
        ? `Neutral (${held}) plays nothing.`
        : `Neutral (${held}) is not trained on: this categorizer was made before Neutral was taught.`;
  return `${view.k} ${view.k === 1 ? 'category' : 'categories'}. ${neutral}`;
}

function StrangersSwitch({ strangers, setStrangers, words }: { strangers: CategorizerStrangers; setStrangers: (m: CategorizerStrangers) => void; words: ModalityWords }) {
  const text = strangersText(words);
  return (
    <fieldset className="space-y-1" data-faces-strangers>
      <legend className="text-[10px] font-bold uppercase tracking-widest text-white/50">{`A ${words.one} I never taught reads as`}</legend>
      {(['neutral', 'nearest'] as const).map((m) => (
        <label key={m} className={`flex cursor-pointer gap-2 rounded-md border p-1.5 ${strangers === m ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10'}`}>
          <input type="radio" name="faces-strangers" value={m} checked={strangers === m} onChange={() => setStrangers(m)} className="mt-0.5" />
          <span>
            <span className="block text-[11px] font-semibold text-white/90">{text[m].title}</span>
            <span className="block text-[10px] leading-snug text-white/55">{text[m].says}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Grid({ s, session, test }: { s: FaceSessionState; session: StoreApi<FaceSessionState>; test: StoreApi<FaceTestState> }) {
  const view = s.view!;
  const words = s.modality.words;
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name]);
  return (
    <div className="space-y-3">
      <StrangersSwitch strangers={view.strangers} setStrangers={s.setStrangers} words={words} />
      {s.modality.id === 'hand' && <HandChoiceSelect value={s.hand} onChange={s.setHand} />}
      {s.modality.id === 'body' && (
        <p className={hint} data-poses-mirror>
          {s.mirror ? 'Left and right are the same pose (chosen before recording).' : 'Left and right are different poses (chosen before recording).'}
        </p>
      )}
      <p data-faces-summary className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-white/80">
        <span className="font-semibold text-emerald-200">{`A ${words.one} you never taught reads as: ${strangersText(words)[view.strangers].title.toLowerCase()}.`}</span> {strangersSummary(view, words)}
      </p>
      {!s.hasStills && !s.figures && <p className={hint}>No pictures were taken, so the categories have none.</p>}
      {!s.hasStills && s.figures && <p className={hint}>Each {words.one} is drawn as a stick figure of what the camera read: no picture of you is kept.</p>}
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
          {s.modality.id === 'face' ? <PlayButton id={m.id} name={m.name} unsaved={s.openId === m.id && s.dirty} /> : <BindButton s={s} id={m.id} name={m.name} unsaved={s.openId === m.id && s.dirty} />}
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

/** The hold ring's words, per phase: what a hold does now. */
function ringWords(phase: 'explore' | 'faces' | 'paused', { one }: Pick<ModalityWords, 'one'>): Record<HoldRingState, string> {
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

/** Whether a key event belongs to a text field (typing a name must not start a burst). */
const typing = (e: KeyboardEvent): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/** The key a burst is held on. */
export const BURST_KEY = 'b';

/**
 * Bursts (#385 E7, design C.4.2 and C.4.6): hold B or the button to record; let go and the burst
 * is one held face. A name typed first puts it straight into the category of that name.
 */
function BurstControls({ s }: { s: FaceSessionState }) {
  const { one } = s.modality.words;
  const { beginBurst, endBurst } = s;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== BURST_KEY || e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      e.preventDefault();
      beginBurst();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === BURST_KEY) endBurst();
    };
    // A key let go in another window never arrives: losing focus ends the burst.
    const blur = () => endBurst();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      endBurst();
    };
  }, [beginBurst, endBurst]);
  const name = s.burstName.trim();
  return (
    <div className="space-y-1 rounded-md border border-white/10 p-2" data-faces-burst={s.burst ? 'on' : 'off'}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Name for the next burst"
          placeholder="Name (optional)"
          value={s.burstName}
          onChange={(e) => s.setBurstName(e.target.value)}
          className="w-36 rounded bg-white/10 px-2 py-0.5 text-xs text-white outline-none focus:bg-white/20"
        />
        <button
          type="button"
          className={s.burst ? primary : btn}
          aria-pressed={s.burst !== null}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            beginBurst();
          }}
          onPointerUp={() => endBurst()}
          onPointerCancel={() => endBurst()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.repeat) {
              e.preventDefault();
              beginBurst();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === 'Enter') endBurst();
          }}
        >
          {s.burst ? 'Recording... let go to keep it' : 'Hold to record a burst (B)'}
        </button>
      </div>
      <p className={hint} aria-live="polite" data-faces-burst-says>
        {s.burst
          ? `Recording a burst${s.burst.label ? ` named "${s.burst.label}"` : ''}: ${s.burst.frames} frames so far. Let go to keep it as one ${one}.`
          : name
            ? `Every frame while you hold it becomes one ${one}, put straight into "${name}" (it stays there however you re-cut).`
            : `Every frame while you hold it becomes one ${one}. Type a name first to put it straight into that category.`}
      </p>
    </div>
  );
}

/** Explore, the rest, Capturing and Paused: one screen (design C.3.1). */
function LiveTake({ s, store }: { s: FaceSessionState; store: StoreApi<FaceSessionState> }) {
  const phase = s.phase as 'explore' | 'rest' | 'faces' | 'paused';
  const { modality } = s;
  const { one, many } = modality.words;
  const read = useCallback((o: { count: number }) => store.getState().live(o), [store]);
  const setup = setupCues(modality);
  const cue = phase === 'rest' ? (setup[s.setupStep] ?? setup[0]) : vocabularyCue(modality);
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
          {phase === 'rest' && s.setupStep > 0 ? cue.name : STATE_TEXT[phase]}
        </span>
        {phase !== 'explore' && <span>{`${s.elapsed.toFixed(0)} s`}</span>}
        {(phase === 'faces' || phase === 'paused') && <span>{`${s.points} held ${s.points === 1 ? one : many}`}</span>}
        {phase !== 'explore' && <span>{s.hasStills ? 'pictures kept in this page only' : s.figures ? 'stick figures only, no pictures' : 'no pictures'}</span>}
      </p>
      <p className="text-sm font-semibold text-white">{instruction}</p>
      {phase !== 'explore' && phase !== 'paused' && <p className={hint}>{cue.rationale}</p>}
      <div className="flex flex-wrap gap-2">
        {phase === 'explore' && (
          <button type="button" className={primary} onClick={() => s.start()}>
            Start capturing (Space)
          </button>
        )}
        {phase === 'rest' && s.setupStep > 0 && (
          <button type="button" className={btn} onClick={() => s.skipSetup()}>
            Skip this step
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
      {(phase === 'faces' || phase === 'paused') && <BurstControls s={s} />}
      {phase !== 'rest' && <HoldRing state={s.hold} taken={s.points} words={ringWords(phase, modality.words)} />}
      <FeatureBars read={read} part={modality.words.part} one={one} />
    </div>
  );
}

/** The tool's view over a session store and its test store, in the store's modality's words. */
export function FaceSessionView({ store, test }: { store: StoreApi<FaceSessionState>; test: StoreApi<FaceTestState> }) {
  const words = useStore(store, (s) => s.modality.words);
  return (
    <WordsContext.Provider value={words}>
      <SessionView store={store} test={test} />
    </WordsContext.Provider>
  );
}

function SessionView({ store, test }: { store: StoreApi<FaceSessionState>; test: StoreApi<FaceTestState> }) {
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
        {`Carving your ${s.modality.words.many}…`}
      </p>
    );
  }
  if (s.phase === 'explore' || s.phase === 'rest' || s.phase === 'faces' || s.phase === 'paused') return <LiveTake s={s} store={store} />;

  return (
    <div className="space-y-3">
      {s.phase === 'idle' && <Intro s={s} />}
      {s.notice && (
        <p className="text-[11px] text-amber-200/90" role="status" aria-live="polite">
          {s.notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} onClick={() => confirmDiscard() && s.explore()}>
          {s.phase === 'idle' ? `Record my ${s.modality.words.many}` : 'Record a new take'}
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

/** What the tool does, before anything is recorded. */
function Intro({ s }: { s: FaceSessionState }) {
  if (s.modality.id === 'hand') {
    return (
      <div className="space-y-2">
        <p className={hint}>
          Record a minute of your own hand shapes: a few seconds of a relaxed hand, then each shape you want to use (a fist, a point, a pinch, any shape you
          like). They are carved into categories you can name and keep, and each one can fire a command. Only the shape counts, not where your hand is or how
          it is turned. First you see what the camera reads; nothing is recorded until you start. Everything stays in this browser.
        </p>
        <HandChoiceSelect value={s.hand} onChange={s.setHand} />
      </div>
    );
  }
  if (s.modality.id === 'body') {
    return (
      <div className="space-y-2">
        <p className={hint}>
          Record a couple of minutes of your own poses: a few seconds standing (or sitting) at rest, three short moves the instrument learns to ignore (closer
          and further, a step aside, a slight turn), then each pose you want to use (arms up, one arm out, a crouch, any pose you like), held for a moment.
          They are carved into categories you can name and keep, and each one can fire a command. Only the pose counts, not where you stand. Stand back far
          enough for the camera to see the whole pose. Each pose is kept as a stick figure; camera pictures only if you ask. Everything stays in this browser.
        </p>
        <PoseOptions s={s} />
      </div>
    );
  }
  return (
    <p className={hint}>
      Record a minute of your own faces: a few seconds of rest, then each face you want the instrument to know. They are carved into categories you can
      name and keep. First you see what the camera reads; nothing is recorded until you start. Everything stays in this browser.
    </p>
  );
}

/** A pose take's two choices (#387 B10, C7), made before recording. */
function PoseOptions({ s }: { s: FaceSessionState }) {
  return (
    <div className="space-y-1 text-[11px] text-white/80">
      <label className="flex items-center gap-2" data-poses-mirror-choice>
        <input type="checkbox" checked={s.mirror} onChange={(e) => s.setMirror(e.target.checked)} />
        <span>Left and right are the same pose (one arm up is one pose, whichever arm)</span>
      </label>
      {s.modality.vocabularies && (
        <label className="flex items-center gap-2" data-poses-vocabulary-choice>
          <span>Default names</span>
          <select
            className="rounded bg-white/10 px-1 py-0.5"
            value={s.vocabulary ?? ''}
            onChange={(e) => s.setVocabulary(e.target.value === '' ? null : e.target.value)}
          >
            {s.modality.vocabularies.map((c) => (
              <option key={c.id ?? ''} value={c.id ?? ''}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2" data-poses-stills-choice>
        <input type="checkbox" checked={s.keepStills} onChange={(e) => s.setKeepStills(e.target.checked)} />
        <span>Also keep camera pictures (they show you and the room; kept in this browser only)</span>
      </label>
    </div>
  );
}

const HAND_CHOICE_TEXT: Record<HandChoice, string> = {
  either: 'Either hand (whichever is in view; the right one when both are)',
  left: 'My left hand only',
  right: 'My right hand only',
};

/** Which hand a hand categorizer reads (#387 C4): kept with it; the live test and the bindings
 *  read that hand. */
function HandChoiceSelect({ value, onChange }: { value: HandChoice; onChange: (h: HandChoice) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-white/80" data-hands-choice>
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">Reads</span>
      <select aria-label="Which hand" value={value} onChange={(e) => onChange(e.target.value as HandChoice)} className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white">
        {HAND_CHOICES.map((h) => (
          <option key={h} value={h}>
            {HAND_CHOICE_TEXT[h]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * "Bind to commands" (#385 E8): a hand categorizer's categories each fire a command, through the
 * host's category bindings (the Gestures tool's "Your categories"). The saved version is bound
 * (its derived model, with the hand it reads), replacing a bound set of the same name and keeping
 * its bindings by category name; the Gestures tool opens on it.
 */
function BindButton({ s, id, name, unsaved }: { s: FaceSessionState; id: string; name: string; unsaved: boolean }) {
  const binder = categoryBinder();
  if (!binder) return null;
  const note = unsaved ? ' (the saved version)' : '';
  return (
    <button type="button" className={btn} aria-label={`Bind ${name} to commands`} title={`Give each of its categories a command${note}, in the Gestures tool`} onClick={() => void s.bindSaved(id, binder)}>
      Bind to commands
    </button>
  );
}

/** The tool's panel: the view over the page's session store (the host's frame closes it). */
export default function FaceSessionPanel(_props: ExtensionToolPanelProps) {
  return <FaceSessionView store={faceSessionStore()} test={faceTestStore()} />;
}

/** "Your hand shapes" (#385 E8): the same view over the page's hand-shape stores. */
export function HandSessionPanel(_props: ExtensionToolPanelProps) {
  return <FaceSessionView store={handSessionStore()} test={handTestStore()} />;
}

/** The pose session tool's panel (#382 = #385 E9): the same view over the body's stores. */
export function PoseSessionPanel(_props: ExtensionToolPanelProps) {
  return <FaceSessionView store={bodySessionStore()} test={bodyTestStore()} />;
}
