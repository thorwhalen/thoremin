/**
 * The face session's saved categorizers: save, open, remove, the import and export of P1's
 * file, and the stills a removal orphans. The ONE module that writes the saved-models
 * collection and the thumbnail store. A concern of `createFaceSessionStore` (#746).
 */
import { type PersonalCategorizer, importCategorizer, exportCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { FaceModelRecord } from '../models';
import { clampTuning, DEFAULT_TUNING } from '@thoremin/sdk/enroll/live';
import { foreignModality, unknownVocabulary } from '@thoremin/sdk/enroll/modality';
import { FACE_SESSION_DEFAULTS } from './state';
import { categoryEntries } from '../../lib/vocabularyEntries';
import type { createStills } from './stills';
import type { createCarve } from './carve';
import type { SessionCtx } from './locals';
import type { FaceSessionState } from './state';

/** The persist concern over the store's shared state. */
export function createPersist(ctx: SessionCtx, h: Pick<ReturnType<typeof createStills>, 'stillsTaken'> & Pick<ReturnType<typeof createCarve>, 'showOpened'>) {
  const { deps, get, loc, modality, set } = ctx;
  const { stillsTaken, showOpened } = h;
  /** Delete the stills of `ids` that no saved record's samples name any more. */
  const dropStillsIfOrphaned = async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const records = await Promise.all((await deps.models.list()).map((x) => deps.models.load(x.id).catch(() => null)));
    // A record that cannot be read may name these holds: then nothing is deleted.
    if (records.some((r) => r === null)) return;
    const named = new Set(records.flatMap((r) => r!.model.categorizer.samples.map((x) => x.id)));
    const orphans = ids.filter((id) => !named.has(id));
    if (orphans.length > 0) await deps.thumbs.remove(orphans).catch(() => undefined);
  };
  const actions: Pick<FaceSessionState, 'save' | 'refreshSaved' | 'open' | 'remove' | 'importFile' | 'exportFile' | 'exportSaved' | 'savedLabels' | 'importSaved' | 'bindSaved'> = {
    async save(name) {
      const { view, phase, saving } = get();
      const trimmed = name.trim();
      if (!view || !trimmed || saving || view.k === 0) return false;
      if (phase !== 'carved' && phase !== 'saved') return false;
      const gen = loc.generation;
      set({ saving: true });
      /** The stills this save filed (removed again if the record is not saved). */
      const filed: string[] = [];
      try {
        let categorizer: PersonalCategorizer;
        const working = get().working;
        const tuningAtStart = get().tuning;
        const checksAtStart = get().checks;
        if (working) categorizer = { ...working, name: trimmed };
        else return false;
        // Every hold's still taken this session, filed under its id once it is encoded (a Save
        // right after Stop must not file a categorizer whose pictures were still being taken).
        // Stills already filed (a saved base's) stay where they are.
        await stillsTaken();
        if (gen !== loc.generation) return false;
        for (const x of categorizer.samples) {
          const still = loc.stills.get(x.id);
          if (still && (await deps.thumbs.put(x.id, still).then(() => true, () => false))) filed.push(x.id);
        }
        // Saving under a name that already exists replaces that record: its stills go too,
        // unless another record (or this one) still names their holds.
        const before = new Map(
          (await Promise.all((await deps.models.list()).map((x) => deps.models.load(x.id))))
            .filter((r): r is FaceModelRecord => r !== null)
            .map((r) => [r.id, r.model.categorizer.samples.map((x) => x.id)]),
        );
        const tuning = get().tuning;
        const checks = get().checks;
        const hasChecks = checks.quiz !== undefined || checks.everyday !== undefined;
        const record = await deps.models.save(trimmed, { categorizer, ...(phase === 'saved' ? { tuning, ...(hasChecks ? { checks } : {}) } : {}) });
        const replaced = before.get(record.id);
        if (replaced) await dropStillsIfOrphaned(replaced);
        if (gen === loc.generation) {
          // An edit made while the save was in flight (a correction, a tuning, a re-cut) is kept,
          // and still unsaved: what was saved is the state when Save was pressed.
          const changed = get().view !== view || get().tuning !== tuningAtStart || get().checks !== checksAtStart;
          set({ notice: `Saved "${record.name}".${changed ? ' Changes made since are not saved yet.' : ''}`, name: record.name, dirty: changed, ...(phase === 'saved' ? { openId: record.id, working: changed && get().working ? { ...get().working!, name: record.name } : record.model.categorizer } : {}) });
          if (phase === 'saved') loc.openRecord = record;
        }
        await get().refreshSaved();
        return true;
      } catch (err) {
        // The record was not saved: the stills filed for it go again, unless a record names them.
        await dropStillsIfOrphaned(filed).catch(() => undefined);
        set({ notice: `Could not save: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)}` });
        return false;
      } finally {
        set({ saving: false });
      }
    },
    async refreshSaved() {
      const saved = await deps.models.list().catch(() => []);
      set({ saved });
    },
    async open(id) {
      const record = await deps.models.load(id);
      if (!record) {
        set({ notice: 'That categorizer could not be read.' });
        return;
      }
      get().reset();
      loc.openRecord = record;
      showOpened(record.model.categorizer, { openId: id, name: record.name, hasStills: true, tuning: clampTuning(record.model.tuning ?? {}), checks: record.model.checks ?? {}, dirty: false });
    },
    async remove(id) {
      const record = await deps.models.load(id);
      await deps.models.remove(id);
      await dropStillsIfOrphaned(record?.model.categorizer.samples.map((x) => x.id) ?? []);
      if (get().openId === id) get().reset();
      await get().refreshSaved();
    },
    importFile(text) {
      const r = importCategorizer(text);
      if (!r.ok) {
        set({ notice: `Could not import: ${r.error}.` });
        return false;
      }
      const foreign = foreignModality(modality, r.categorizer);
      if (foreign) {
        set({ notice: `Could not import: this is ${foreign}.` });
        return false;
      }
      get().reset();
      const taken = get().saved.some((s) => s.name.trim().toLowerCase() === r.categorizer.name.trim().toLowerCase());
      // An unknown vocabulary id is dropped and said so, not silently ignored (#465).
      const badVocabulary = unknownVocabulary(modality, r.categorizer);
      const { vocabulary: _dropped, ...rest } = r.categorizer;
      const imported = badVocabulary ? rest : r.categorizer;
      showOpened(imported, {
        openId: null,
        name: r.categorizer.name,
        tuning: DEFAULT_TUNING,
        dirty: true,
        notice:
          `Imported "${r.categorizer.name}"${r.migratedFrom !== null ? ` (from file version ${r.migratedFrom})` : ''}. A file carries no pictures. Save to keep it` +
          (taken ? '; saving under the same name replaces the one you have.' : '.') +
          (badVocabulary ? ` Note: ${badVocabulary}.` : ''),
      });
      return true;
    },
    exportFile(asked) {
      const { phase, working } = get();
      const given = asked?.trim() || get().name.trim();
      if ((phase !== 'saved' && phase !== 'carved') || !working) return null;
      const name = given || working.name || (modality.id === 'face' ? FACE_SESSION_DEFAULTS.exportName : `My ${modality.words.many}`);
      return { name, text: exportCategorizer({ ...working, name }) };
    },
    async exportSaved(id) {
      const record = await deps.models.load(id).catch(() => null);
      if (!record) {
        set({ notice: 'That categorizer could not be read.' });
        return null;
      }
      return { name: record.name, text: exportCategorizer({ ...record.model.categorizer, name: record.name }) };
    },
    async savedLabels(id) {
      const record = await deps.models.load(id).catch(() => null);
      return record ? record.model.categorizer.categories.map((c) => c.label) : null;
    },
    async importSaved(id, importer, confirm) {
      const record = await deps.models.load(id).catch(() => null);
      if (!record) {
        set({ notice: 'That categorizer could not be read.' });
        return false;
      }
      const entries = categoryEntries(record.model.categorizer);
      const taken = entries.filter((e) => importer.canonical(e.label) !== null);
      if (taken.length === 0) {
        set({ notice: `None of the categories of "${record.name}" is named as one of the ${importer.label} (${entries.map((e) => `"${e.label}"`).join(', ')}). Rename them first.` });
        return false;
      }
      const replaced = [...new Set(taken.filter((e) => importer.has(e.label)).map((e) => importer.canonical(e.label)!))];
      if (replaced.length > 0 && !confirm(`The ${importer.label} already have ${replaced.join(', ')}. Replace ${replaced.length === 1 ? 'it' : 'them'} with the ones from "${record.name}"?`)) return false;
      try {
        const r = await importer.import(entries, { hand: record.model.categorizer.hand ?? 'either' });
        const skipped = r.skipped.length > 0 ? ` Skipped ${r.skipped.map((l) => `"${l}"`).join(', ')} (not a name the ${importer.label} take, or too few samples).` : '';
        const warned = r.warnings.length > 0 ? ` Note: ${r.warnings.join('; ')}.` : '';
        set({ notice: r.imported.length > 0 ? `Now in the ${importer.label}: ${r.imported.join(', ')}.${skipped}${warned}` : `Nothing was imported.${skipped}` });
        return r.imported.length > 0;
      } catch (err) {
        set({ notice: `Could not import: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)}` });
        return false;
      }
    },
    async bindSaved(id, binder) {
      const record = await deps.models.load(id).catch(() => null);
      if (!record) {
        set({ notice: 'That categorizer could not be read.' });
        return false;
      }
      try {
        // By id (#371): the host reads the record itself, with its tuning, its modality and its hand.
        await binder.bind({ id: record.id });
        return true;
      } catch (e) {
        set({ notice: `Not bound: ${e instanceof Error ? e.message : String(e)}.` });
        return false;
      }
    },
  };
  return { dropStillsIfOrphaned, actions };
}
