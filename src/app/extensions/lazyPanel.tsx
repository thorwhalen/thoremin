/**
 * A lazy extension's editor section before its code is here (`docs/design/lazy-extensions.md`):
 * `Controls` and `Readout` placeholders that load the extension's React half the first time
 * they render, show the shared {@link LoadStatusReadout} while it loads, and then render the
 * real component. A failed load says so and offers a Reload (a browser never refetches a failed
 * `import()` in the same page; the settings persist, so the reload comes back on the same
 * instrument); it never throws into the shell.
 *
 * A placeholder inside a CLOSED `<details>` (a collapsed `TopSection`, which keeps its children
 * mounted) waits for it to open, so opening the editor fetches nothing until the player opens
 * that section.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import type { ExtensionPanel, ExtensionPanelDecl, ExtensionToolDecl, ExtensionToolPanelProps, ExtensionUi } from '@thoremin/sdk-ui/types';
import { LoadStatusReadout } from '@/app/LoadStatusReadout';
import { useExtensionLoad } from '@/app/extensionLoadStatus';

/**
 * @param extensionId - whose load status the Readout shows: under the chosen instrument's row it
 *   says the extension is loading, or that it failed with a Reload, and is silent otherwise.
 * @param reload - the Reload action (the page reload; a parameter so a test can watch it).
 */
export function lazyPanel(
  decl: ExtensionPanelDecl,
  load: () => Promise<ExtensionUi>,
  extensionId: string = decl.instrumentId,
  reload: () => void = () => window.location.reload(),
): ExtensionPanel {
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
      const here = useRef<HTMLDivElement>(null);
      const status = useExtensionLoad((st) => st.status[extensionId]);
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
      }, [Component]);
      // Under the row, a failed load of the extension's nodes outranks its (loaded) readout: the
      // readout would only say "absent", the player needs to know why and how to retry.
      const nodesFailed = key === 'Readout' && status?.phase === 'error';
      if (Component && !nodesFailed) return <Component />;
      if (error) {
        return (
          <div ref={here} className="space-y-1" data-lazy-extension={decl.instrumentId}>
            <LoadStatusReadout status={{ phase: 'error', message: `${decl.section} could not load (${error}). Reload the page to try again; your instrument is kept.` }} enabled />
            <button type="button" className="text-[11px] text-white/70 underline hover:text-white" onClick={reload}>
              Reload
            </button>
          </div>
        );
      }
      // The Controls say they are loading; a Readout under the instrument's row reports the
      // extension's own load (its nodes), with a Reload when that failed.
      if (nodesFailed) {
        return (
          <div ref={here} className="space-y-1" data-lazy-extension={decl.instrumentId}>
            <LoadStatusReadout status={{ phase: 'error', message: `${decl.section} could not load (${status!.message}). Reload the page to try again; your instrument is kept.` }} enabled />
            <button type="button" className="text-[11px] text-white/70 underline hover:text-white" onClick={reload}>
              Reload
            </button>
          </div>
        );
      }
      const loading = key === 'Controls' || status?.phase === 'loading';
      return (
        <div ref={here} data-lazy-extension={decl.instrumentId}>
          {loading && <LoadStatusReadout status={{ phase: 'loading', message: `Loading ${decl.section}…` }} enabled />}
        </div>
      );
    }
    LazyExtensionPart.displayName = `Lazy${key}(${decl.instrumentId})`;
    return LazyExtensionPart;
  };
  return { instrumentId: decl.instrumentId, section: decl.section, Controls: part('Controls'), Readout: part('Readout') };
}

/**
 * A lazy extension's TOOL panel before its code is here (#330): the content of the tool's frame,
 * which loads the extension's React half the first time the tool opens (the host mounts it only
 * while the tool is open, so a cold load fetches nothing), shows the shared readout while it
 * loads and the real panel once loaded. A failed load says so with a Reload, like a section.
 */
export function lazyToolPanel(
  decl: ExtensionToolDecl,
  load: () => Promise<ExtensionUi>,
  reload: () => void = () => window.location.reload(),
): ComponentType<ExtensionToolPanelProps> {
  let loaded: ComponentType<ExtensionToolPanelProps> | null = null;
  function LazyExtensionTool(props: ExtensionToolPanelProps) {
    const [Component, setComponent] = useState<ComponentType<ExtensionToolPanelProps> | null>(() => loaded);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
      if (Component) return;
      let live = true;
      load()
        .then((ui) => {
          const tool = ui.tools?.find((t) => t.id === decl.id);
          if (!tool) throw new Error(`the extension's UI has no tool "${decl.id}"`);
          return tool.Panel;
        })
        .then(
          (c) => {
            loaded = c;
            if (live) setComponent(() => c);
          },
          (err: unknown) => {
            if (live) setError(err instanceof Error ? err.message : String(err));
          },
        );
      return () => {
        live = false;
      };
    }, [Component]);
    if (Component) return <Component {...props} />;
    if (error) {
      return (
        <div className="space-y-1" data-lazy-extension={decl.id}>
          <LoadStatusReadout status={{ phase: 'error', message: `${decl.label} could not load (${error}). Reload the page to try again.` }} enabled />
          <button type="button" className="text-[11px] text-white/70 underline hover:text-white" onClick={reload}>
            Reload
          </button>
        </div>
      );
    }
    return (
      <div data-lazy-extension={decl.id}>
        <LoadStatusReadout status={{ phase: 'loading', message: `Loading ${decl.label}…` }} enabled />
      </div>
    );
  }
  LazyExtensionTool.displayName = `LazyTool(${decl.id})`;
  return LazyExtensionTool;
}
