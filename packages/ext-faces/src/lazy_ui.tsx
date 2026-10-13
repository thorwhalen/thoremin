/**
 * The faces extension's React half, DEFERRED: the face session tool's panel (and through it the
 * session, the carving, the stills and the saved collection), the instrument editor's "Face
 * categorizer" section, and the mount effect that resolves the instrument's categorizer for the
 * DAG (#330 P4). Loaded by the host's build with a dynamic `import()` (`extensions.json`'s
 * `lazy.ui`) the first time the player opens the tool or the section, or a composed graph names
 * the categorizer node, so none of it is in the main chunk (`docs/design/lazy-extensions.md`).
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { useDialsSettings } from '@thoremin/sdk-ui/dials';
import FaceSessionPanel from './panels/FaceSessionPanel';
import CategorizerSection from './panels/CategorizerSection';
import { startCategorizerPlay, useCategorizerPlay } from './app/categorizerPlay';
import { FACES_TOOL } from './ui';

/** One line: which categorizer the face chords read right now. */
function CategorizerReadout() {
  const play = useCategorizerPlay();
  const { state } = useDialsSettings();
  const chords = (state.effective as Record<string, unknown>)['face.mapping'] === 'chord';
  const text = play.phase === 'ready' ? (chords ? `Reading with ${play.name}` : `${play.name}, for the face chords (off)`) : play.phase === 'loading' ? 'Loading…' : play.phase === 'missing' ? 'Not on this device: the general model plays' : 'The general model';
  return <span className="text-[10px] text-white/50" data-faces-readout>{text}</span>;
}

/** The section, with the readout under it: the host renders an extension's `Readout` only under
 *  an air or sign instrument's row (`AIR_INSTRUMENTS`), which a categorizer is not, so the
 *  section is where the player sees what the face chords read with (#359). */
function CategorizerControls() {
  return (
    <div className="space-y-1">
      <CategorizerSection />
      <CategorizerReadout />
    </div>
  );
}

export const FACES_UI: ExtensionUi = {
  id: 'faces',
  panels: [{ instrumentId: 'faces', section: 'Face categorizer', Controls: CategorizerControls, Readout: CategorizerReadout }],
  statusHooks: [],
  // Resolve the categorizer the instrument names and hand it to the DAG, for the app's lifetime.
  // A host with no hot store (a headless test that loads this half) has nothing to resolve.
  onMount: [
    () => {
      try {
        return startCategorizerPlay();
      } catch (err) {
        console.warn('faces: the categorizer is not resolved (no hot store):', err);
        return undefined;
      }
    },
  ],
  tools: [{ ...FACES_TOOL, Panel: FaceSessionPanel }],
};

export default FACES_UI;
