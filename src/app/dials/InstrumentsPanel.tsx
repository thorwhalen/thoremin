/**
 * InstrumentsPanel — the top-right surface for the "instruments" flow (Phase 4),
 * replacing the old gear/settings button. Closed, it is a single instrument icon.
 * Open, it shows either:
 *  - the LIST: the named instruments; clicking a name selects & plays it (immediate
 *    feedback), the gear opens that instrument's editor;
 *  - the EDITOR: the dials-rendered {@link DialsControlsPanel} for the selected
 *    instrument, with a back arrow, an unsaved-edits dot, and a Save-with-confirm that
 *    commits the working layer into the selected instrument.
 *
 * Edits flow into the dials store and are continuously autosaved to a hidden
 * "Last modified" layer ({@link useInstruments}); the named instrument is only
 * overwritten on an explicit, confirmed Save. Re-selecting an instrument reverts.
 */
import { useState } from 'react';
import { Music2, Settings, X, ArrowLeft } from 'lucide-react';
import DialsControlsPanel from './DialsControlsPanel';
import { useInstruments } from './useInstruments';
import { useDialsSettings } from './useDialsSettings';

const cardCls =
  'absolute right-3 top-3 flex max-h-[calc(100dvh-1.5rem)] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/60 backdrop-blur';

export default function InstrumentsPanel() {
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [confirming, setConfirming] = useState(false);
  const [newName, setNewName] = useState('');
  const { list, selected, ready, select, save, create } = useInstruments();
  const { state } = useDialsSettings();
  const dirty = state.dirty.length > 0;

  const close = () => {
    setOpen(false);
    setView('list');
    setConfirming(false);
  };

  const doCreate = async () => {
    const n = newName.trim();
    if (!n) return;
    await create(n);
    setNewName('');
  };

  const openEditor = (name: string) => {
    select(name);
    setConfirming(false);
    setView('editor');
  };

  const doSave = async () => {
    if (selected) await save(selected);
    setConfirming(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open instruments"
        className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/50 p-2.5 text-white/80 backdrop-blur transition hover:text-white"
      >
        <Music2 className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className={cardCls}>
      {view === 'list' ? (
        <>
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/70">
              <Music2 className="h-3.5 w-3.5" /> Instruments
            </span>
            <button
              onClick={close}
              aria-label="Close"
              className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-auto p-2" aria-busy={!ready}>
            {!ready ? (
              <p className="px-2 py-3 text-[11px] text-white/40">Loading instruments…</p>
            ) : (
              <ul className="space-y-0.5">
                {list.map((p) => {
                  const isSel = p.name === selected;
                  return (
                    <li
                      key={p.name}
                      className={`flex items-center gap-1 rounded-lg ${isSel ? 'bg-white/10' : 'hover:bg-white/5'}`}
                    >
                      <button
                        className={`flex flex-1 items-center gap-2 truncate px-2 py-2 text-left text-xs transition ${
                          isSel ? 'text-emerald-300' : 'text-white/80 hover:text-white'
                        }`}
                        title="Select & play"
                        onClick={() => select(p.name)}
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${isSel ? 'bg-emerald-400' : 'bg-white/20'}`}
                          aria-hidden
                        />
                        <span className="truncate">{p.name}</span>
                        {isSel && dirty && (
                          <span className="ml-1 shrink-0 text-[9px] uppercase tracking-widest text-amber-300/80">edited</span>
                        )}
                      </button>
                      <button
                        className="rounded p-2 text-white/40 transition hover:bg-white/10 hover:text-white"
                        title={`Edit ${p.name}`}
                        aria-label={`Edit ${p.name}`}
                        onClick={() => openEditor(p.name)}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="px-2 pb-2 pt-3 text-[10px] leading-relaxed text-white/40">
              Click a name to play it. The gear edits an instrument; your tweaks are kept until you Save.
            </p>
            <div className="mt-1 flex gap-1 border-t border-white/10 px-2 pt-2">
              <input
                className="flex-1 rounded bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/30 focus:bg-white/20"
                placeholder="Save current sound as…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doCreate();
                }}
              />
              <button
                className="rounded bg-white/10 px-2 py-1 text-xs text-white/80 transition hover:bg-white/20 disabled:opacity-40"
                disabled={!newName.trim()}
                onClick={() => void doCreate()}
              >
                Save
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <button
              onClick={() => {
                setView('list');
                setConfirming(false);
              }}
              aria-label="Back to instruments"
              className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <span className="flex flex-1 items-center gap-1.5 truncate text-[11px] font-bold uppercase tracking-widest text-white/70">
              <span className="truncate">{selected ?? 'Settings'}</span>
              {dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Unsaved edits" aria-label="Unsaved edits" />}
            </span>
            <button
              onClick={() => setConfirming(true)}
              disabled={!dirty || !selected}
              className="rounded bg-white/10 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-white/80 transition hover:bg-white/20 hover:text-white disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={close}
              aria-label="Close"
              className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {confirming && (
            <div className="flex items-center justify-between gap-2 border-b border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-[10px]">
              <span className="truncate text-amber-200/80">Override “{selected}” with these settings?</span>
              <span className="flex shrink-0 gap-1">
                <button
                  onClick={() => void doSave()}
                  className="rounded bg-emerald-500/80 px-2 py-0.5 font-bold text-black transition hover:bg-emerald-400"
                >
                  Save
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded bg-white/10 px-2 py-0.5 text-white/80 transition hover:bg-white/20"
                >
                  Cancel
                </button>
              </span>
            </div>
          )}
          <div className="overflow-auto p-4">
            <DialsControlsPanel />
          </div>
        </>
      )}
    </div>
  );
}
