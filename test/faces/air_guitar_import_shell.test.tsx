// @vitest-environment jsdom
/**
 * "Use as air guitar chords" is REACHABLE (#451, the shipping rule): with the air extension's
 * importer provided (its UI mounts it at app start), a saved hand-shape categorizer's row in Your
 * hand shapes offers it. Clicks from a cold load: Tools (1), Your hand shapes (2), Use as air
 * guitar chords (3); the notice says what was imported. A build without the air extension shows
 * no such button.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import ToolsBar from '@/app/tools/ToolsBar';
import ToolsLauncher from '@/app/tools/ToolsLauncher';
import ExtensionToolPanels from '@/app/tools/ExtensionToolPanels';
import { useTools } from '@/app/tools/toolsStore';
import { importCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { createCategorizerStore } from '@thoremin/sdk-ui/enroll/categorizers';
import { provideVocabularyImporter, vocabularyImporters } from '@thoremin/sdk-ui/enroll/vocabularyImport';
import { handSessionStore } from '@thoremin/ext-faces/app/handSession';
import { createVocabularyState, useVocabularyStore, type VocabularyRecord } from '@thoremin/ext-air/app/vocabularyStore';
import { guitarVocabularyImporter, AIR_GUITAR_IMPORTER_ID } from '@thoremin/ext-air/app/guitarImport';
import { chordShapeFeatureIds } from '@thoremin/ext-air/lib/hand_shape';
import { AIR, FACES } from '../helpers/extensions';
import '@/app/dials/useDialsSettings';
import '@/app/dispatchDial';

let withdraw: (() => void) | null = null;
beforeEach(() => {
  localStorage.clear();
  useTools.setState({ open: null, launcherOpen: false });
  handSessionStore().getState().reset();
});
afterEach(() => {
  cleanup();
  withdraw?.();
  withdraw = null;
  useVocabularyStore(null);
});

describe.runIf(AIR && FACES)('Use as air guitar chords, from the shell', () => {
  it('Tools, Your hand shapes, Use as air guitar chords: three clicks, the chords imported', async () => {
    const file = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
    if (!file.ok) throw new Error(file.error);
    // Its categories named as chords, its samples moved into the guitar's feature space.
    const f = chordShapeFeatureIds();
    const categorizer = {
      ...file.categorizer,
      features: f,
      weights: Object.fromEntries(f.map((k) => [k, 1])),
      samples: file.categorizer.samples.map((x, i) => ({ ...x, vector: Object.fromEntries(f.map((k, j) => [k, (i % 3) + j * 0.01])), support: Array.from({ length: 4 }, () => f.map((_, j) => (i % 3) + j * 0.01)) })),
      categories: file.categorizer.categories.map((c, i) => ({ ...c, label: ['G', 'Am', 'C', 'D', 'E', 'F', 'Em'][i] ?? `x${i}` })),
    };
    await createCategorizerStore(handModality).save('Shapes', { categorizer });
    useVocabularyStore(createInMemoryProvider<VocabularyRecord>([], { idField: 'id', searchFields: ['name'] }));
    const state = createVocabularyState({ name: 'guitar', features: f, publish: () => {} });
    withdraw = provideVocabularyImporter(guitarVocabularyImporter({ state, frettingHand: () => 'left' }));
    render(
      <>
        <ToolsBar />
        <ToolsLauncher />
        <ExtensionToolPanels />
      </>,
    );
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Your hand shapes', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Use Shapes as air guitar chords' }, { timeout: 5000 }));
    await screen.findByText(/^Now in the air guitar chords: G/, undefined, { timeout: 3000 });
    expect(state.getState().vocab.entries.map((e) => e.label)).toContain('G');
  });

  it('a categorizer with no chord names gets no button', async () => {
    const file = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
    if (!file.ok) throw new Error(file.error);
    await createCategorizerStore(handModality).save('Plain', { categorizer: file.categorizer });
    useVocabularyStore(createInMemoryProvider<VocabularyRecord>([], { idField: 'id', searchFields: ['name'] }));
    withdraw = provideVocabularyImporter(guitarVocabularyImporter({ state: createVocabularyState({ name: 'guitar', features: chordShapeFeatureIds(), publish: () => {} }) }));
    render(<ExtensionToolPanels />);
    act(() => useTools.getState().toggleTool('hand-shapes'));
    await screen.findByRole('button', { name: 'Open Plain' }, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Use Plain as air guitar chords' })).toBeNull();
  });

  it('the air extension\'s UI mount provides the importer for hand categorizers, and withdraws it', async () => {
    const { default: AIR_UI } = await import('@thoremin/ext-air/ui');
    // Each effect on its own: one that needs more of the app must not hide this one.
    const cleanups = (AIR_UI.onMount ?? []).map((m) => {
      try {
        return m();
      } catch {
        return undefined;
      }
    });
    expect(vocabularyImporters('hand').map((i) => i.id)).toContain(AIR_GUITAR_IMPORTER_ID);
    expect(vocabularyImporters('body')).toEqual([]);
    for (const c of cleanups) if (typeof c === 'function') c();
    expect(vocabularyImporters('hand').map((i) => i.id)).not.toContain(AIR_GUITAR_IMPORTER_ID);
  });

  it('no importer, no button', async () => {
    const file = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
    if (!file.ok) throw new Error(file.error);
    await createCategorizerStore(handModality).save('Plain', { categorizer: file.categorizer });
    render(<ExtensionToolPanels />);
    act(() => useTools.getState().toggleTool('hand-shapes'));
    await screen.findByRole('button', { name: 'Open Plain' }, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Use Plain as air guitar chords' })).toBeNull();
  });
});
