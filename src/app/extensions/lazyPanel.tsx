/**
 * A lazy extension's editor section before its code is here (`docs/design/lazy-extensions.md`):
 * `Controls` and `Readout` placeholders that load the extension's React half the first time
 * they render, show the shared {@link LoadStatusReadout} while it loads, and then render the
 * real component. A failed load says so and offers a retry; it never throws into the shell.
 *
 * A placeholder inside a CLOSED `<details>` (a collapsed `TopSection`, which keeps its children
 * mounted) waits for it to open, so opening the editor fetches nothing until the player opens
 * that section.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import type { ExtensionPanel, ExtensionPanelDecl, ExtensionUi } from '@thoremin/sdk-ui/types';
import { LoadStatusReadout } from '@/app/LoadStatusReadout';

export function lazyPanel(decl: ExtensionPanelDecl, load: () => Promise<ExtensionUi>): ExtensionPanel {
  const part = (key: 'Controls' | 'Readout'): ComponentType => {
    const resolve = () =>
      load().then((ui) => {
        const panel = ui.panels.find((p) => p.instrumentId === decl.instrumentId);
        if (!panel) throw new Error(`the extension's UI has no panel for "${decl.instrumentId}"`);
        return panel[key];
      });
    let loaded: ComponentType | null = null;
    function LazyExtensionPart() {
      const [Component, setComponent] = useState<ComponentType | null>(() => loaded);
      const [error, setError] = useState<string | null>(null);
      const [attempt, setAttempt] = useState(0);
      const here = useRef<HTMLDivElement>(null);
      useEffect(() => {
        if (Component) return;
        let live = true;
        const details = here.current?.closest('details');
        const start = () => {
          if (!live) return;
          setError(null);
          resolve().then(
            (c) => {
              loaded = c;
              if (live) setComponent(() => c);
            },
            (err: unknown) => {
              if (live) setError(err instanceof Error ? err.message : String(err));
            },
          );
        };
        const onToggle = () => {
          if (details?.open) {
            details.removeEventListener('toggle', onToggle);
            start();
          }
        };
        if (details && !details.open) details.addEventListener('toggle', onToggle);
        else start();
        return () => {
          live = false;
          details?.removeEventListener('toggle', onToggle);
        };
      }, [Component, attempt]);
      if (Component) return <Component />;
      if (error) {
        return (
          <div ref={here} className="space-y-1" data-lazy-extension={decl.instrumentId}>
            <LoadStatusReadout status={{ phase: 'error', message: `${decl.section} could not load: ${error}` }} enabled />
            <button type="button" className="text-[11px] text-white/70 underline hover:text-white" onClick={() => setAttempt((a) => a + 1)}>
              Retry
            </button>
          </div>
        );
      }
      // Only the Controls say so: a Readout under an instrument row stays quiet while loading.
      return (
        <div ref={here} data-lazy-extension={decl.instrumentId}>
          {key === 'Controls' && <LoadStatusReadout status={{ phase: 'loading', message: `Loading ${decl.section}…` }} enabled />}
        </div>
      );
    }
    LazyExtensionPart.displayName = `Lazy${key}(${decl.instrumentId})`;
    return LazyExtensionPart;
  };
  return { instrumentId: decl.instrumentId, section: decl.section, Controls: part('Controls'), Readout: part('Readout') };
}
