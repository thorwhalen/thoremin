/**
 * TagManager — the tag-manager sub-view (issue #113): list every custom tag and let the
 * user rename its label (the hidden id — and every association — is preserved), change
 * its emoji by text search ({@link EmojiPicker}), or delete it (guarded with a confirm
 * when the tag is still applied to instruments, since deleting strips it everywhere).
 * System tags are derived, not listed here — they cannot be edited.
 */
import { useState } from 'react';
import { ArrowLeft, X, Trash2 } from 'lucide-react';
import type { LibraryApi } from './useLibrary';
import EmojiPicker from './EmojiPicker';

export default function TagManager({
  api,
  onBack,
  onClose,
}: {
  api: LibraryApi;
  onBack: () => void;
  onClose: () => void;
}) {
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const draftFor = (id: string, label: string) => drafts[id] ?? label;
  const setDraft = (id: string, value: string) => setDrafts((d) => ({ ...d, [id]: value }));

  const commitRename = (id: string, label: string) => {
    const next = draftFor(id, label).trim();
    if (next && next !== label) void api.renameTag(id, next);
    setDrafts((d) => {
      const { [id]: _, ...rest } = d;
      return rest;
    });
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <button
          onClick={onBack}
          aria-label="Back to instruments"
          className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-white/70">
          Manage tags
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="overflow-auto p-2">
        {api.tags.length === 0 ? (
          <p className="px-2 py-4 text-[11px] leading-relaxed text-white/40">
            No tags yet. Open an instrument’s editor and add tags in its Tags section — they’ll
            appear here to rename, re-emoji, or delete.
          </p>
        ) : (
          <ul className="space-y-1">
            {api.tags.map((t) => {
              const uses = api.usageCount(t.id);
              return (
                <li key={t.id} className="rounded-lg bg-white/5">
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <button
                      onClick={() => setPickerFor(pickerFor === t.id ? null : t.id)}
                      title="Change emoji"
                      aria-label={`Change emoji for ${t.label}`}
                      className={`rounded p-1 text-lg leading-none transition hover:bg-white/10 ${
                        pickerFor === t.id ? 'bg-white/15' : ''
                      }`}
                    >
                      {t.emoji}
                    </button>
                    <input
                      className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs text-white/80 outline-none focus:bg-white/10"
                      value={draftFor(t.id, t.label)}
                      onChange={(e) => setDraft(t.id, e.target.value)}
                      onBlur={() => commitRename(t.id, t.label)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      aria-label={`Rename tag ${t.label}`}
                    />
                    <span className="shrink-0 text-[10px] text-white/30" title={`Used by ${uses} instrument(s)`}>
                      {uses > 0 ? `${uses}×` : ''}
                    </span>
                    <button
                      onClick={() => (uses > 0 ? setConfirmDelete(t.id) : void api.deleteTag(t.id))}
                      title={uses > 0 ? `Used by ${uses} — delete` : 'Delete tag'}
                      aria-label={`Delete tag ${t.label}`}
                      className="rounded p-1 text-white/30 transition hover:bg-white/10 hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {confirmDelete === t.id && (
                    <div className="flex items-center justify-between gap-2 border-t border-red-300/20 bg-red-300/5 px-2 py-1.5 text-[10px]">
                      <span className="truncate text-red-200/80">
                        Delete “{t.label}”? It’s on {uses} instrument{uses === 1 ? '' : 's'}.
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <button
                          onClick={() => {
                            setConfirmDelete(null);
                            void api.deleteTag(t.id);
                          }}
                          className="rounded bg-red-500/80 px-2 py-0.5 font-bold text-black transition hover:bg-red-400"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="rounded bg-white/10 px-2 py-0.5 text-white/80 transition hover:bg-white/20"
                        >
                          Cancel
                        </button>
                      </span>
                    </div>
                  )}

                  {pickerFor === t.id && (
                    <div className="px-2 pb-2">
                      <EmojiPicker
                        value={t.emoji}
                        onPick={(emoji) => {
                          void api.setTagEmoji(t.id, emoji);
                          setPickerFor(null);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-2 pb-1 pt-3 text-[10px] leading-relaxed text-white/40">
          Renaming keeps a tag’s identity — every instrument using it updates automatically.
        </p>
      </div>
    </>
  );
}
