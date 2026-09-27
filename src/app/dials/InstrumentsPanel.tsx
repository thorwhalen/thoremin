/**
 * InstrumentsPanel — the top-right surface for the instruments flow. Closed, it is a
 * single instrument icon. Open, it shows one of three sub-views:
 *  - the LIST: the instrument library — each row selects & plays on click, shows its
 *    derived system tags + custom tags, a favorite star, and (on hover) a compact
 *    parametrization tooltip; the header carries a name filter, a sort control, and a
 *    "manage tags" entry (Instrument library UX epic #116: #112 starring/sort/filter,
 *    #113 tags column, #114 system tags, #115 tooltip). The rows are grouped by the
 *    instrument's DERIVED category (`library/category.ts`, #249): field instruments,
 *    then air instruments — one place to choose any instrument, each chosen by the same
 *    click. The chosen air drum carries its live readout under its row. The list is a
 *    RENDERING of the instruments collection (`library/instrumentsCollection.ts`, Round 4
 *    #272): the collection declares the search, the sorts, the grouping and the
 *    operations over the instrument spec, and the specs provider answers the query
 *    (`library/instrumentsCatalog.ts`); this component draws what comes back. The
 *    drawing itself is a temporary in-repo stand-in for zodal's collection-view renderer
 *    (i2mint/zodal#14; migration tracked in thorwhalen/thoremin#283);
 *  - the EDITOR: the dials-rendered {@link DialsControlsPanel} for the selected
 *    instrument, preceded by its Tags section and a "Set as default" toggle (default is
 *    now a per-instrument setting, decoupled from the star — #112), with a back arrow, an
 *    unsaved-edits dot, and a Save-with-confirm;
 *  - the TAG MANAGER: rename / re-emoji / delete custom tags ({@link TagManager}).
 *
 * Live edits flow into the dials store; the named instrument is only overwritten on an
 * explicit, confirmed Save. Library metadata (favorites, tags, associations) persists via
 * {@link useLibrary}; the single default pointer via {@link useInstruments}.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Music2,
  Settings,
  X,
  ArrowLeft,
  Star,
  Search,
  Tags,
  Check,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  List,
  LayoutGrid,
} from 'lucide-react';
import InstrumentPicture from '@/app/library/InstrumentPicture';
import DialsControlsPanel from './DialsControlsPanel';
import { useInstruments } from './useInstruments';
import { useDialsSettings } from './useDialsSettings';
import { useLibrary } from '@/app/library/useLibrary';
import InstrumentTags from '@/app/library/InstrumentTags';
import TagsEditor from '@/app/library/TagsEditor';
import { TrainingLink } from '@/app/training/TrainingLink';
import TagManager from '@/app/library/TagManager';
import { summaryLines } from '@/app/library/summarize';
import { AIR_INSTRUMENTS, airInstrumentsOf, groupByCategory, type AirInstrumentId } from '@/app/library/category';
import { assembleSpec, type InstrumentSpec } from '@/instruments/spec';
import { instrumentsCollection, type InstrumentSort } from '@/app/library/instrumentsCollection';
import { queryInstruments, useInstrumentsCatalog } from '@/app/library/instrumentsCatalog';
import { useInstrumentsView } from '@/app/library/instrumentsViewPrefs';
import { listingOf, whyMatched, type Listing } from '@/app/library/instrumentsListing';
import { chipValue, facetView, type FacetFamilyId, type FacetSelection } from '@/app/library/instrumentsFacets';
import { INSTRUMENT_CLASSES } from '@/instruments/classes';

/** A class's colour (the class registry's SSOT), for the row stripe and the heading swatch. */
const classColour = (id: string): string => INSTRUMENT_CLASSES.find((c) => c.id === id)?.colour ?? 'rgba(255,255,255,0.3)';
import { layerToSettings } from '@/settings/dials';
import { AIR_UI } from './panels/air';

const cardFrame =
  'shell-instruments-card absolute right-3 top-3 flex max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/60 backdrop-blur';
const cardCls = `${cardFrame} w-96`;
/**
 * The gallery needs room for pictures: up to 40rem, but never so wide that it runs under the
 * left-hand tool panels (24rem + their inset) on a tablet, and never narrower than the list.
 * Columns follow the width (`auto-fill`), not the screen.
 */
const galleryCardCls = `${cardFrame} w-[max(24rem,min(40rem,calc(100vw-27rem)))]`;

/** The longest picture reference the field accepts. A reference is a URL or a path; a
 *  multi-megabyte pasted `data:` URL would be bytes, which the metadata record must never
 *  hold (Decision 7): it would fill localStorage and silently stop the library saving. */
const MAX_PICTURE_REF = 2048;

/** Why a picture reference is refused, or undefined when it is fine. */
export function pictureRefProblem(ref: string): string | undefined {
  if (/^(data|blob):/i.test(ref)) return 'Use a URL or a path, not an embedded picture.';
  if (/^javascript:/i.test(ref)) return 'That is not a picture address.';
  if (ref.length > MAX_PICTURE_REF) return `Too long (${ref.length} characters; ${MAX_PICTURE_REF} at most).`;
  return undefined;
}

/** The glyph a picture-less card shows: the instrument's own emoji, else the emoji of the
 *  air instrument it plays (from its branches); undefined leaves the tile its initials. */
const tileEmoji = (spec: { emoji?: string; features: readonly string[] }): string | undefined =>
  spec.emoji ?? AIR_INSTRUMENTS.find((a) => spec.features.includes(`air-${a.id}`))?.emoji;

/**
 * The picture field in an instrument's editor: a reference (a URL, or a path under the
 * app's `public/`), previewed, written to the library's metadata (`setImage`), never bytes.
 */
function PictureField({
  name,
  image,
  emoji,
  colour,
  onSet,
}: {
  name: string;
  image?: string;
  emoji?: string;
  colour: string;
  onSet: (image: string | null) => void;
}) {
  const [draft, setDraft] = useState(image ?? '');
  useEffect(() => setDraft(image ?? ''), [image, name]);
  const trimmed = draft.trim();
  const problem = trimmed ? pictureRefProblem(trimmed) : undefined;
  const unchanged = (trimmed || undefined) === image;
  const commit = () => {
    if (problem || unchanged) return;
    onSet(trimmed ? trimmed : null);
  };
  return (
    <div className="flex items-center gap-2" data-picture-field>
      <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md border border-white/10">
        <InstrumentPicture image={image} name={name} emoji={emoji} colour={colour} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <label className="block text-[10px] uppercase tracking-widest text-white/45" htmlFor="instrument-picture">
          Picture (for the gallery)
        </label>
        <div className="flex gap-1">
          <input
            id="instrument-picture"
            className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/30 focus:bg-white/20"
            placeholder="https://… or instruments/my-picture.webp"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
          />
          <button
            type="button"
            onClick={commit}
            disabled={unchanged || problem !== undefined}
            className="rounded bg-white/10 px-2 py-1 text-xs text-white/80 transition hover:bg-white/20 disabled:opacity-40"
          >
            Set
          </button>
          {image && (
            <button
              type="button"
              onClick={() => onSet(null)}
              aria-label="Clear the picture"
              className="rounded px-2 py-1 text-xs text-white/50 transition hover:bg-white/10 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
        {problem && (
          <p role="alert" className="text-[10px] text-rose-300/90">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The spec for an instrument the library could not derive: a saved instrument whose settings
 * no longer parse (a sound or voicing since renamed, say) has no spec, and dropping it would
 * make it vanish from the one place a player can pick, edit or re-save it. It is listed under
 * its cached class (else the default one), with nothing else claimed about it.
 */
function undecidedSpec(name: string, cachedClass: string | undefined): InstrumentSpec {
  return assembleSpec({ name, layer: {}, meta: cachedClass ? { class: cachedClass } : undefined });
}

const searchAffordance = instrumentsCollection.affordances.search;
const SEARCH_PLACEHOLDER = (typeof searchAffordance === 'object' && searchAffordance.placeholder) || 'Filter…';

/** The width below which the shell is laid out for a phone (Tailwind's `sm`, the same
 *  breakpoint at which the tools bar keeps only its launcher). */
export const PHONE_MAX_WIDTH_PX = 639;

/**
 * Whether the Instruments panel starts open. On a desktop, yes: choosing an instrument is
 * the first thing to do, and the panel takes a column the video can spare. On a phone, no:
 * the panel is the full width of the screen, so open on load it covered the video (the
 * instrument itself), the header, and sat under the "Tap to play" button (Round 4, a
 * live-site render at 390x844). There it is one tap away, on its icon.
 */
function startsOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`).matches;
}

export default function InstrumentsPanel() {
  const [open, setOpen] = useState(startsOpen);
  const [view, setView] = useState<'list' | 'editor' | 'tags'>('list');
  const [confirming, setConfirming] = useState(false);
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<InstrumentSort>('default');
  const { list, selected, ready, select, save, create, defaultName, setDefault } = useInstruments();
  const library = useLibrary(list);
  // The collection's items: the library's specs, once derived, in the library's order,
  // built only while the list is what is showing (the editor re-renders on every slider
  // move). The query runs against the specs provider; a signature keys the effect, since
  // `useLibrary` hands back fresh functions every render.
  const specs =
    library.derivedReady && view === 'list'
      ? list.map((p) => library.specOf(p.name) ?? undecidedSpec(p.name, library.categoryOf(p.name)))
      : [];
  // Each spec with what the library knows about it: its search text, its facets and the
  // reasons a query can match it (option B of #272; `instrumentsListing.ts`).
  const listings: Listing[] = specs.map((spec) =>
    listingOf(spec, {
      customTags: library.customTagsOf(spec.name),
      systemTags: library.systemTagsOf(spec.name),
      summary: (() => {
        const sum = library.summaryOf(spec.name);
        return sum ? summaryLines(sum) : [];
      })(),
    }),
  );
  const listingById = new Map(listings.map((l) => [l.item.id, l]));
  const specsSig = JSON.stringify(listings.map((l) => l.item));
  const [queried, setQueried] = useState(false);
  useEffect(() => {
    if (!library.derivedReady || view !== 'list') return;
    let live = true;
    void queryInstruments(
      listings.map((l) => l.item),
      query,
      sort,
    ).then(() => live && setQueried(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- specsSig stands for specs
  }, [specsSig, query, sort, library.derivedReady, view]);
  const matched = useInstrumentsCatalog((s) => s.items);
  // The facets narrow what the search kept; their counts come from @zodal/groups-core
  // (`instrumentsFacets.ts`). The selection is per visit: a filter remembered across visits
  // would hide instruments from a player who has forgotten setting it.
  const [facetSel, setFacetSel] = useState<FacetSelection>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Keyed on what it reads: the panel re-renders on every dial write while the list shows.
  const matchedSig = matched.map((m) => m.id).join('\n');
  const facets = useMemo(
    () =>
      facetView(
        listings.map((l) => l.facet),
        matched.map((m) => m.id),
        facetSel,
        { order: { class: INSTRUMENT_CLASSES.map((c) => c.id) } },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sigs stand for listings and matched
    [specsSig, matchedSig, facetSel],
  );
  const shown = matched.filter((m) => facets.allowed.has(m.id));
  const activeFilters = Object.values(facetSel).reduce((n, set) => n + (set?.size ?? 0), 0);
  const toggleFacet = (family: FacetFamilyId, value: string) =>
    setFacetSel((cur) => {
      const next = new Set(cur[family] ?? []);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...cur, [family]: next };
    });
  const collapsed = useInstrumentsView((s) => s.collapsed);
  const viewMode = useInstrumentsView((s) => s.view);
  const setViewMode = useInstrumentsView((s) => s.setView);
  const toggleCollapsed = useInstrumentsView((s) => s.toggleCollapsed);
  useEffect(() => {
    void useInstrumentsView.getState().hydrate(INSTRUMENT_CLASSES.map((c) => c.id));
  }, []);
  const { state } = useDialsSettings();
  const dirty = state.dirty.length > 0;
  // The air instruments playing right now (the live dials, not a saved instrument): the
  // chosen row shows their readouts, so a drum left on is never invisible (#249).
  const liveAir = useMemo(
    () => airInstrumentsOf(layerToSettings(state.effective as Record<string, unknown>)),
    [state.effective],
  );
  // The air instruments whose sections lead the editor — decided when it opens.
  const [editorLead, setEditorLead] = useState<readonly AirInstrumentId[]>([]);

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
    setEditorLead(library.summaryOf(name)?.air ?? []);
    select(name);
    setConfirming(false);
    setView('editor');
  };

  const doSave = async () => {
    if (selected) await save(selected);
    setConfirming(false);
  };

  /** The parametrization tooltip text for a row (issue #115), or a fallback hint. */
  const tooltipFor = (name: string): string => {
    const summary = library.summaryOf(name);
    if (!summary) return 'Click to play';
    return summaryLines(summary)
      .map((l) => `${l.label}: ${l.value}`)
      .join('\n');
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

  if (view === 'tags') {
    return (
      <div className={cardCls}>
        <TagManager api={library} onBack={() => setView('list')} onClose={close} />
      </div>
    );
  }

  if (view === 'editor') {
    const isDefault = selected != null && selected === defaultName;
    return (
      <div className={cardCls}>
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
            {dirty && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Unsaved edits" aria-label="Unsaved edits" />
            )}
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
        <div className="space-y-4 overflow-auto p-4">
          {selected && (
            <div className="space-y-3">
              <button
                onClick={() => setDefault(selected)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
                  isDefault
                    ? 'border-amber-300/40 bg-amber-300/10 text-amber-200'
                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
                title={isDefault ? 'This instrument opens on load — click to clear' : 'Open this instrument on load'}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    isDefault ? 'border-amber-300 bg-amber-300 text-black' : 'border-white/30'
                  }`}
                >
                  {isDefault && <Check className="h-3 w-3" />}
                </span>
                {isDefault ? 'Default instrument (opens on load)' : 'Set as default (opens on load)'}
              </button>
              <TagsEditor instrument={selected} api={library} />
              {(() => {
                const spec = library.specOf(selected);
                const cls = spec?.class ?? library.categoryOf(selected) ?? 'field';
                return (
                  <PictureField
                    name={selected}
                    image={library.imageOf(selected)}
                    emoji={spec ? tileEmoji(spec) : undefined}
                    colour={classColour(cls)}
                    onSet={(img) => library.setImage(selected, img)}
                  />
                );
              })()}
            </div>
          )}
          <div className="border-t border-white/10 pt-3">
            {/* #263/#269: where this instrument's training lives, from its spec. */}
            {selected && (
              <div className="mb-2">
                <TrainingLink spec={library.specOf(selected)} />
              </div>
            )}
            <DialsControlsPanel leadAir={editorLead} />
          </div>
        </div>
      </div>
    );
  }

  // --- LIST view ---------------------------------------------------------------------
  // One place to choose any instrument (#249): the list is grouped by the instrument's
  // derived category (theremin / air), and every row is chosen the same way.
  const groups = groupByCategory(shown, (p) => p.class);
  const searching = query.trim().length > 0 || activeFilters > 0;
  const isGroupCollapsed = (id: string, size: number) => !searching && size > 0 && collapsed.includes(id);

  // One line per instrument (option A of #272): a stripe in its class's colour, the name,
  // its tags, the star and the gear. The chosen row shows its air instruments' live
  // readouts under that line: the first thing a player needs after choosing the Air Drum
  // is "strike once to teach each hand".
  /** The live readouts of the air instruments playing now (under the chosen row, or under
   *  its class heading when that class is collapsed: never hidden with the row). */
  const renderReadouts = (ids: readonly AirInstrumentId[]) =>
    ids.map((id) => {
      const Readout = AIR_UI[id].Readout;
      return (
        <div key={id} className="px-2 pb-2">
          <Readout />
        </div>
      );
    });

  const renderRow = (p: InstrumentSpec) => {
    const isSel = p.name === selected;
    const isDefault = p.name === defaultName;
    const isStar = library.starred(p.name);
    // Under the row, unless its class is collapsed: then under the class heading instead.
    const readouts = isSel && !isGroupCollapsed(p.class, 1) ? liveAir : [];
    const colour = classColour(p.class);
    return (
      <li
        key={p.name}
        data-instrument={p.name}
        className={`rounded-md border-l-[3px] ${isSel ? 'bg-white/10' : 'hover:bg-white/5'}`}
        style={{ borderLeftColor: isSel ? colour : `color-mix(in srgb, ${colour} 55%, transparent)` }}
      >
        <div className="flex items-center gap-1 pr-0.5">
          <button
            className={`flex min-w-[7rem] flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs transition ${
              isSel ? 'text-emerald-300' : 'text-white/80 hover:text-white'
            }`}
            title={tooltipFor(p.name)}
            onClick={() => select(p.name)}
          >
            {/* The name keeps its room; a match reason beside it clips first. */}
            <span className="max-w-[75%] shrink-0 truncate">{p.name}</span>
            {(() => {
              // A match that is not in the name says why (a tag, a summary line).
              const why = whyMatched(p.name, listingById.get(p.id)?.reasons ?? [], query);
              return why ? <span className="min-w-0 truncate text-[9.5px] text-white/40">{why}</span> : null;
            })()}
            {isDefault && (
              <span className="shrink-0 text-[9px] uppercase tracking-widest text-amber-300/70">(default)</span>
            )}
            {isSel && dirty && (
              <span className="shrink-0 text-[9px] uppercase tracking-widest text-amber-300/80">edited</span>
            )}
          </button>
          <InstrumentTags inline systemTags={library.systemTagsOf(p.name)} customTags={library.customTagsOf(p.name)} />
          <button
            className={`rounded p-1 transition hover:bg-white/10 ${isStar ? 'text-amber-300' : 'text-white/25 hover:text-white/70'}`}
            title={isStar ? 'Unfavorite' : 'Favorite'}
            aria-label={isStar ? `Unfavorite ${p.name}` : `Favorite ${p.name}`}
            aria-pressed={isStar}
            onClick={() => library.toggleStar(p.name)}
          >
            <Star className={`h-3.5 w-3.5 ${isStar ? 'fill-current' : ''}`} />
          </button>
          <button
            className="rounded p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
            title={`Edit ${p.name}`}
            aria-label={`Edit ${p.name}`}
            onClick={() => openEditor(p.name)}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
        {renderReadouts(readouts)}
      </li>
    );
  };

  // One card per instrument in the gallery: its picture (or its emoji on its class's colour),
  // its name, the star and the gear. A click on the picture or the name plays it, like a
  // click on a row.
  const renderCard = (p: InstrumentSpec) => {
    const isSel = p.name === selected;
    const isStar = library.starred(p.name);
    const colour = classColour(p.class);
    return (
      <li
        key={p.name}
        data-instrument={p.name}
        className={`overflow-hidden rounded-lg border ${isSel ? 'border-emerald-400/60' : 'border-white/10 hover:border-white/25'}`}
        style={{ borderTopColor: colour, borderTopWidth: 3 }}
      >
        <button type="button" className="block w-full text-left" title={tooltipFor(p.name)} onClick={() => select(p.name)}>
          <div className="aspect-[16/10] w-full">
            <InstrumentPicture image={p.image} name={p.name} emoji={tileEmoji(p)} colour={colour} />
          </div>
          <div className={`flex items-center gap-1.5 px-2 pt-1 text-xs ${isSel ? 'text-emerald-300' : 'text-white/85'}`}>
            <span className="min-w-0 truncate">{p.name}</span>
            {p.name === defaultName && (
              <span className="shrink-0 text-[9px] uppercase tracking-widest text-amber-300/70">(default)</span>
            )}
            {isSel && dirty && (
              <span className="shrink-0 text-[9px] uppercase tracking-widest text-amber-300/80">edited</span>
            )}
          </div>
          {(() => {
            const why = whyMatched(p.name, listingById.get(p.id)?.reasons ?? [], query);
            return why ? <div className="truncate px-2 text-[9.5px] text-white/40">{why}</div> : null;
          })()}
        </button>
        <div className="flex items-center gap-0.5 px-1 pb-1">
          <div className="min-w-0 flex-1 pl-1">
            <InstrumentTags inline systemTags={library.systemTagsOf(p.name)} customTags={library.customTagsOf(p.name)} />
          </div>
          <button
            className={`rounded p-1 transition hover:bg-white/10 ${isStar ? 'text-amber-300' : 'text-white/25 hover:text-white/70'}`}
            title={isStar ? 'Unfavorite' : 'Favorite'}
            aria-label={isStar ? `Unfavorite ${p.name}` : `Favorite ${p.name}`}
            aria-pressed={isStar}
            onClick={() => library.toggleStar(p.name)}
          >
            <Star className={`h-3.5 w-3.5 ${isStar ? 'fill-current' : ''}`} />
          </button>
          <button
            className="rounded p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
            title={`Edit ${p.name}`}
            aria-label={`Edit ${p.name}`}
            onClick={() => openEditor(p.name)}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </li>
    );
  };
  const gallery = viewMode === 'grid';

  return (
    <div className={gallery ? galleryCardCls : cardCls}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/70">
          <Music2 className="h-3.5 w-3.5" /> Instruments
        </span>
        <span className="flex items-center gap-1">
          <button
            onClick={() => setView('tags')}
            aria-label="Manage tags"
            title="Manage tags"
            className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <Tags className="h-4 w-4" />
          </button>
          <button
            onClick={close}
            aria-label="Close"
            className="rounded p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </span>
      </div>
      <div className="overflow-auto p-2" aria-busy={!ready}>
        {!ready || !library.derivedReady || !queried ? (
          <p className="px-2 py-3 text-[11px] text-white/40">Loading instruments…</p>
        ) : (
          <>
            {list.length > 3 && (
              <div className="mb-1.5 flex items-center gap-1.5">
                <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-white/5 px-2">
                  <Search className="h-3 w-3 shrink-0 text-white/30" aria-hidden />
                  <input
                    className="w-full bg-transparent py-1.5 text-xs text-white/80 outline-none placeholder:text-white/30"
                    placeholder={SEARCH_PLACEHOLDER}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Filter instruments"
                  />
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as InstrumentSort)}
                  aria-label="Sort instruments"
                  className="rounded-lg bg-white/5 px-1.5 py-1.5 text-[11px] text-white/70 outline-none transition hover:bg-white/10"
                >
                  <option value="default">Sort: default</option>
                  <option value="star">Sort: starred</option>
                  <option value="name">Sort: name</option>
                </select>
                <button
                  type="button"
                  // While a filter is on, the chips stay (what is filtered is always visible),
                  // so the toggle has nothing to hide: it says how to close them instead.
                  onClick={() => activeFilters === 0 && setFiltersOpen((o) => !o)}
                  aria-expanded={filtersOpen || activeFilters > 0}
                  aria-controls={filtersOpen || activeFilters > 0 ? 'instrument-filters' : undefined}
                  title={
                    activeFilters > 0
                      ? 'Clear the filters to close them'
                      : 'Filter by class, starred, tags and what an instrument uses'
                  }
                  className={`flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] transition ${
                    activeFilters > 0
                      ? 'bg-emerald-500/20 text-emerald-200'
                      : filtersOpen
                        ? 'bg-white/15 text-white/85'
                        : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  <SlidersHorizontal className="h-3 w-3" aria-hidden />
                  <span>Filters{activeFilters > 0 ? ` ${activeFilters}` : ''}</span>
                </button>
                {/* The two views the collection declares; the last choice is remembered. */}
                <span className="flex overflow-hidden rounded-lg bg-white/5">
                  {(
                    [
                      ['list', List, 'List view'],
                      ['grid', LayoutGrid, 'Gallery view'],
                    ] as const
                  ).map(([mode, Icon, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewMode(mode)}
                      aria-pressed={viewMode === mode}
                      aria-label={label}
                      title={label}
                      className={`p-1.5 transition ${viewMode === mode ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white'}`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ))}
                </span>
              </div>
            )}
            {/* The chips stay open while any is on: what is filtered is always visible. */}
            {(filtersOpen || activeFilters > 0) && (
              <div id="instrument-filters" className="mb-1.5 space-y-1 px-1" data-instrument-filters>
                {facets.families.map((f) => (
                  <div key={f.id} role="group" aria-label={`Filter by ${f.label.toLowerCase()}`} className="flex flex-wrap items-center gap-1">
                    <span className="w-12 shrink-0 text-[9px] uppercase tracking-widest text-white/35">{f.label}</span>
                    {f.chips.map((c) => (
                      <button
                        key={String(c.group)}
                        type="button"
                        aria-pressed={c.selected}
                        onClick={() => toggleFacet(f.id, chipValue(c))}
                        title={c.hint ?? c.label}
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition ${
                          c.selected
                            ? 'border-emerald-400/45 bg-emerald-500/20 text-emerald-200'
                            : 'border-white/10 text-white/60 hover:text-white'
                        }`}
                      >
                        {f.id === 'class' && (
                          <span className="h-1.5 w-1.5 rounded-sm" style={{ background: classColour(chipValue(c)) }} aria-hidden />
                        )}
                        <span>{c.label}</span>
                        <span className="text-white/35">{c.count}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {activeFilters > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setFacetSel({});
                      setFiltersOpen(true);
                    }}
                    className="text-[10px] text-white/45 underline-offset-2 hover:text-white/80 hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
            {(() => {
              // The filters never hide what you hear without saying so (option A's promise).
              const hidden = activeFilters > 0 && selected && !shown.some((m) => m.name === selected);
              return hidden ? (
                <p className="px-2 pb-1 text-[10px] text-emerald-300/80">
                  playing: {selected} <span className="text-white/40">(not in these filters)</span>
                </p>
              ) : null;
            })()}
            {groups.map((g) =>
              g.items.length === 0 && (searching || g.id !== 'air') ? null : (
                <section key={g.id} role="group" aria-label={g.label} data-category={g.id} className="mb-1.5">
                  {(() => {
                    // A collapsed class still says what it holds, names the instrument being
                    // played when it is in there, and keeps its live readouts showing: the
                    // list never hides what you hear. A search opens every class (a match
                    // inside a collapsed one would otherwise show as a bare count), and an
                    // empty class never hides the guidance on how to fill it.
                    const isCollapsed = isGroupCollapsed(g.id, g.items.length);
                    const playing = isCollapsed ? g.items.find((p) => p.name === selected) : undefined;
                    const Chevron = isCollapsed ? ChevronRight : ChevronDown;
                    return (
                      <>
                        <h3>
                          <button
                            type="button"
                            onClick={() => toggleCollapsed(g.id)}
                            aria-expanded={!isCollapsed}
                            aria-controls={`instruments-${g.id}`}
                            data-collapse-class={g.id}
                            title={isCollapsed ? `Show the ${g.label.toLowerCase()}` : `Hide the ${g.label.toLowerCase()}`}
                            className="flex w-full items-center gap-1.5 rounded px-1 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-widest text-white/45 transition hover:text-white/70"
                          >
                            <Chevron className="h-3 w-3 shrink-0" aria-hidden />
                            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: classColour(g.id) }} aria-hidden />
                            <span>{g.label}</span>
                            <span className="font-normal text-white/30">{g.items.length}</span>
                            {playing && (
                              <span className="ml-auto truncate font-normal normal-case tracking-normal text-emerald-300/80">
                                playing: {playing.name}
                              </span>
                            )}
                          </button>
                        </h3>
                        {playing && renderReadouts(liveAir)}
                      </>
                    );
                  })()}
                  <ul
                    id={`instruments-${g.id}`}
                    className={gallery ? 'grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5' : 'space-y-px'}
                    hidden={isGroupCollapsed(g.id, g.items.length)}
                  >
                    {g.items.map(gallery ? renderCard : renderRow)}
                    {g.items.length === 0 && (
                      <li className="col-span-full px-2 py-2 text-[10px] leading-relaxed text-white/40">
                        None saved. Turn on {AIR_INSTRUMENTS.map((a) => a.label.toLowerCase()).join(' or ')} in any
                        instrument’s settings and save it.
                      </li>
                    )}
                  </ul>
                  {/* In the gallery, the chosen card's live readouts sit under its class's cards. */}
                  {gallery && !isGroupCollapsed(g.id, g.items.length) && g.items.some((p) => p.name === selected) && renderReadouts(liveAir)}
                </section>
              ),
            )}
            {shown.length === 0 && (
              <p className="px-2 py-3 text-[11px] text-white/40">
                {query.trim() ? `No instruments match “${query.trim()}”` : 'No instruments'}
                {activeFilters > 0 ? ' with these filters' : ''}.
              </p>
            )}
          </>
        )}
        {/* The "click a name to play it" paragraph is gone (#272): each row's tooltip says
            what the instrument does, and the star and gear carry their own labels. */}
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
    </div>
  );
}
