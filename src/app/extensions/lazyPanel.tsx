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
import { useEffect, useRef, useState, type ComponentType, type RefObject } from 'react';
import type { ExtensionPanel, ExtensionPanelDecl, ExtensionToolDecl, ExtensionToolPanelProps, ExtensionUi } from '@thoremin/sdk-ui/types';
import { LoadStatusReadout } from '@thoremin/sdk-ui/loadStatus';
import { useExtensionLoad } from '@/app/engine/extensionLoadStatus';

/** The page reload: a browser never refetches a failed `import()` in the same page. */
const reloadPage = (): void => window.location.reload();

/**
 * "Could not load", with a Reload: the one failure readout every lazy placeholder shows.
 *
 * @param lazyId - the `data-lazy-extension` marker (the panel's instrument id, the tool's id).
 * @param containerRef - the placeholder's own ref, kept on the failure readout so a section's
 *   `<details>` lookup sees the same element in every state.
 */
export function LoadFailed({
  message,
  reload,
  lazyId,
  containerRef,
}: {
  message: string;
  reload: () => void;
  lazyId: string;
  containerRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={containerRef} className="space-y-1" data-lazy-extension={lazyId}>
      <LoadStatusReadout status={{ phase: 'error', message }} enabled />
      <button type="button" className="text-[11px] text-white/70 underline hover:text-white" onClick={reload}>
        Reload
      </button>
    </div>
  );
}

export interface LazyPanelOptions {
  /** Whose load status the Readout shows: under the chosen instrument's row it says the
   *  extension is loading, or that it failed with a Reload, and is silent otherwise. Default
   *  the panel's instrument id. */
  extensionId?: string;
  /** The Reload action (the page reload; an option so a test can watch it). */
  reload?: () => void;
}

export function lazyPanel(
  decl: ExtensionPanelDecl,
  load: () => Promise<ExtensionUi>,
  { extensionId = decl.instrumentId, reload = reloadPage }: LazyPanelOptions = {},
): ExtensionPanel {
  const part = (key: 'Controls' | 'Readout'): ComponentType => {
    const resolve = () =>
      load().then((ui) => {
        // By id AND section: one extension may give one instrument several sections (the faces
        // extension's face and pose categorizers), and by id alone each showed the first's.
        const panel = ui.panels.find((p) => p.instrumentId === decl.instrumentId && p.section === decl.section);
        if (!panel) throw new Error(`the extension's UI has no panel "${decl.section}" for "${decl.instrumentId}"`);
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
      // The Controls say they are loading; a Readout under the instrument's row reports the
      // extension's own load (its nodes), with a Reload when that failed.
      const failure = error || (nodesFailed ? status!.message : null);
      if (failure !== null) {
        return (
          <LoadFailed
            containerRef={here}
            lazyId={decl.instrumentId}
            reload={reload}
            message={`${decl.section} could not load (${failure}). Reload the page to try again; your instrument is kept.`}
          />
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
  return { instrumentId: decl.instrumentId, section: decl.section, readoutOn: decl.readoutOn, Controls: part('Controls'), Readout: part('Readout') };
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
  reload: () => void = reloadPage,
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
    if (error) return <LoadFailed lazyId={decl.id} reload={reload} message={`${decl.label} could not load (${error}). Reload the page to try again.`} />;
    return (
      <div data-lazy-extension={decl.id}>
        <LoadStatusReadout status={{ phase: 'loading', message: `Loading ${decl.label}…` }} enabled />
      </div>
    );
  }
  LazyExtensionTool.displayName = `LazyTool(${decl.id})`;
  return LazyExtensionTool;
}
