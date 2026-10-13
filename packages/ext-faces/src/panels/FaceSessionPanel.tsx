/**
 * The face categorizer session, as a panel (#330 P2): record a take of your own faces, see it
 * carved into categories with their faces, choose how many and how neutral is treated, name
 * them, and save several. The host draws the frame (`ExtensionToolPanels`); this is its content.
 *
 * Rendering only: every action is the session store's (`../app/sessionStore.ts`). Closing the
 * tool (unmounting this) stops a recording, so nothing keeps sampling with no panel to say so.
 */
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { ExtensionToolPanelProps } from '@thoremin/sdk-ui/types';
import type { CategorizerMode } from '@thoremin/sdk/enroll/categorizer';
import { faceSessionStore } from '../app/faceSession';
import { isRecording, type FaceSessionState } from '../app/sessionStore';
import { FACE_REST_CUE, FACE_VOCABULARY_CUE } from '../lib/take';
import type { CarveView, CarvedCategory } from '../lib/carving';

const btn = 'rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/90 transition hover:bg-white/20 disabled:opacity-40';
const primary = 'rounded-md border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-40';
const hint = 'text-[11px] leading-relaxed text-white/60';

/** The two modes, stated plainly: what k counts, and what a resting face reads as. */
export const MODE_TEXT: Record<CategorizerMode, { title: string; says: string }> = {
  partition: {
    title: 'Every face is a category',
    says: 'Your resting face is one of the categories, so k counts it too (your expressions + 1). Whatever your face does, the instrument reads some category.',
  },
  reject: {
    title: 'Neutral means "none of these"',
    says: 'Faces close to your resting face are set aside and read as nothing, so k counts only your expressions.',
  },
};

/** One line saying which mode is in use and what k means in it. */
export function modeSummary(view: CarveView): string {
  if (view.mode === 'partition') return `${view.k} categories, your neutral face included. Every face reads as one of them.`;
  const aside = view.neutral.count === 1 ? '1 held face' : `${view.neutral.count} held faces`;
  return view.neutralKnown
    ? `${view.k} expressions. Neutral is "none of these" (${aside} set aside as neutral).`
    : `${view.k} expressions. There was no rest to tell neutral by, so nothing was set aside.`;
}

const sourceText = (c: CarvedCategory): string =>
  c.source === 'edited'
    ? 'your name'
    : c.source === 'neutral'
      ? 'mostly your resting face'
      : c.source === 'matched'
        ? `the general model reads "${c.matched}"`
        : c.source === 'kept'
          ? 'saved name'
          : 'no general label fits';

// `key` is declared on the props: the repo ships no @types/react, so JSX does not add it.
function Still({ url, label, first }: { key?: number; url?: string; label: string; first: boolean }) {
  return (
    <figure className="flex w-16 shrink-0 flex-col items-center gap-0.5">
      {url ? (
        <img src={url} alt={label} data-face-still className="h-12 w-16 rounded object-cover" />
      ) : (
        <div className="flex h-12 w-16 items-center justify-center rounded bg-white/5 text-[9px] text-white/30">no picture</div>
      )}
      <figcaption className="text-[9px] text-white/40">{first ? 'most typical' : 'less typical'}</figcaption>
    </figure>
  );
}

function CategoryCard({ c, thumbs, rename }: { key?: string; c: CarvedCategory; thumbs: Readonly<Record<number, string>>; rename: (id: string, label: string) => void }) {
  const [text, setText] = useState(c.label);
  useEffect(() => setText(c.label), [c.label]);
  const commit = () => {
    if (text.trim() && text.trim() !== c.label) rename(c.id, text);
    else setText(c.label);
  };
  return (
    <li data-face-category={c.id} className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="flex items-center gap-2">
        <input
          aria-label={`Name of ${c.label}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setText(c.label);
          }}
          className="min-w-0 flex-1 rounded bg-white/10 px-2 py-0.5 text-xs font-semibold text-white outline-none focus:bg-white/20"
        />
        <span className="shrink-0 text-[10px] text-white/50">{c.size} held</span>
      </div>
      <p className="text-[10px] text-white/40">{sourceText(c)}</p>
      <div className="flex gap-1.5 overflow-x-auto">
        {c.exemplars.map((e, i) => (
          <Still key={e.index} url={thumbs[e.index]} label={`${c.label}, example ${i + 1}`} first={i === 0} />
        ))}
      </div>
    </li>
  );
}

function ModeSwitch({ mode, setMode, disabled }: { mode: CategorizerMode; setMode: (m: CategorizerMode) => void; disabled: boolean }) {
  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend className="text-[10px] font-bold uppercase tracking-widest text-white/50">Neutral</legend>
      {(['reject', 'partition'] as const).map((m) => (
        <label key={m} className={`flex cursor-pointer gap-2 rounded-md border p-1.5 ${mode === m ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10'}`}>
          <input type="radio" name="faces-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-0.5" />
          <span>
            <span className="block text-[11px] font-semibold text-white/90">{MODE_TEXT[m].title}</span>
            <span className="block text-[10px] leading-snug text-white/55">{MODE_TEXT[m].says}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function KControl({ s }: { s: FaceSessionState }) {
  const view = s.view!;
  const max = Math.max(1, Math.min(view.maxK, 12));
  if (s.phase === 'saved') return <p className={hint}>{`k = ${view.k}. Changing k re-divides a take, so it needs a new recording.`}</p>;
  if (view.maxK === 0) return null;
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-[11px] text-white/80">
        <span className="w-20 shrink-0">How many: {view.k}</span>
        <input
          type="range"
          aria-label="Number of categories"
          min={1}
          max={max}
          step={1}
          value={Math.min(view.k, max)}
          onChange={(e) => s.setK(Number(e.target.value))}
          className="flex-1"
        />
      </label>
      <p className={hint}>
        {`Suggested: ${view.suggestedK}. A suggestion from how the faces group, not a rule. `}
        {view.k !== view.suggestedK && view.suggestedK > 0 && (
          <button type="button" className="underline hover:text-white" onClick={() => s.setK(view.suggestedK)}>
            Use {view.suggestedK}
          </button>
        )}
      </p>
    </div>
  );
}

function Grid({ s }: { s: FaceSessionState }) {
  const view = s.view!;
  const [name, setName] = useState(s.name);
  useEffect(() => setName(s.name), [s.name]);
  return (
    <div className="space-y-3">
      <ModeSwitch mode={view.mode} setMode={s.setMode} disabled={s.phase === 'saved'} />
      <p data-faces-summary className="rounded-md bg-white/5 px-2 py-1 text-[11px] text-white/80">
        <span className="font-semibold text-emerald-200">In use: {MODE_TEXT[view.mode].title}.</span> {modeSummary(view)}
      </p>
      <KControl s={s} />
      {!s.hasVideo && <p className={hint}>This take kept no video, so the categories have no pictures.</p>}
      <ul className="space-y-2">
        {view.categories.map((c) => (
          <CategoryCard key={c.id} c={c} thumbs={s.thumbs} rename={s.rename} />
        ))}
      </ul>
      {view.mode === 'reject' && view.neutral.count > 0 && (
        <div data-face-neutral className="space-y-1.5 rounded-lg border border-dashed border-white/15 p-2">
          <p className="text-xs font-semibold text-white/70">Neutral: none of these</p>
          <p className="text-[10px] text-white/40">{`${view.neutral.count} held faces close to your rest. They read as no category.`}</p>
          <div className="flex gap-1.5 overflow-x-auto">
            {view.neutral.exemplars.map((i, j) => (
              <Still key={i} url={s.thumbs[i]} label={`neutral, example ${j + 1}`} first={j === 0} />
            ))}
          </div>
        </div>
      )}
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
      </form>
    </div>
  );
}

function SavedList({ s }: { s: FaceSessionState }) {
  if (s.saved.length === 0) return <p className={hint}>No saved categorizers yet.</p>;
  return (
    <ul className="space-y-1" data-faces-saved>
      {s.saved.map((m) => (
        <li key={m.id} className={`flex items-center gap-2 rounded px-1.5 py-1 text-[11px] ${s.openId === m.id ? 'bg-emerald-500/10' : ''}`}>
          <span className="min-w-0 flex-1 truncate text-white/85">{m.name}</span>
          <span className="shrink-0 text-[10px] text-white/40">{new Date(m.createdAt).toLocaleDateString()}</span>
          <button type="button" className={btn} aria-label={`Open ${m.name}`} onClick={() => void s.open(m.id)}>
            Open
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

export function FaceSessionView({ store }: { store: StoreApi<FaceSessionState> }) {
  const s = useStore(store);
  useEffect(() => {
    void store.getState().refreshSaved();
    // Closing the tool stops a recording: nothing keeps sampling with no panel to say so.
    return () => {
      const { phase, reset } = store.getState();
      if (isRecording(phase)) reset();
    };
  }, [store]);

  if (s.phase === 'stopping') {
    return (
      <p className="text-sm text-white/80" role="status" aria-live="polite" data-faces-recording="stopping">
        Carving your faces…
      </p>
    );
  }
  if (s.phase === 'rest' || s.phase === 'faces') {
    const cue = s.phase === 'rest' ? FACE_REST_CUE : FACE_VOCABULARY_CUE;
    return (
      <div className="space-y-2" data-faces-recording={s.phase}>
        <p className="text-sm font-semibold text-white">{cue.instruction}</p>
        <p className={hint}>{cue.rationale}</p>
        <p className="text-[11px] text-white/70" role="status" aria-live="polite">
          {`${s.elapsed.toFixed(0)} s`}
          {s.phase === 'faces' && ` · ${s.points} held face${s.points === 1 ? '' : 's'}`}
          {s.hasVideo ? ' · video kept in this page only' : ' · no video'}
        </p>
        <button type="button" className={primary} onClick={() => void s.stop()}>
          Stop and carve
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {s.phase === 'idle' && (
        <p className={hint}>
          Record a minute of your own faces: a few seconds of rest, then each face you want the instrument to know. They are carved into categories you can
          name and keep. Everything stays in this browser.
        </p>
      )}
      {s.notice && (
        <p className="text-[11px] text-amber-200/90" role="status" aria-live="polite">
          {s.notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} onClick={() => s.start()}>
          {s.phase === 'idle' ? 'Record my faces' : 'Record a new take'}
        </button>
        {s.phase !== 'idle' && (
          <button type="button" className={btn} onClick={() => s.reset()}>
            Close the grid
          </button>
        )}
      </div>
      {(s.phase === 'carved' || s.phase === 'saved') && s.view && <Grid s={s} />}
      <div className="space-y-1 border-t border-white/10 pt-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-white/50">Saved categorizers</h3>
        <SavedList s={s} />
      </div>
    </div>
  );
}

/** The tool's panel: the view over the page's session store (the host's frame closes it). */
export default function FaceSessionPanel(_props: ExtensionToolPanelProps) {
  return <FaceSessionView store={faceSessionStore()} />;
}
