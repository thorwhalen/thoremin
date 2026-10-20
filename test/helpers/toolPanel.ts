/**
 * Host props for rendering an extension tool's panel outside the shell's frame (#600 S18b): the
 * frame binds these to the tool's id (`src/app/tools/ExtensionToolPanels.tsx`); a test that renders a
 * panel alone gets no-ops, and passes its own `close`.
 */
import type { ExtensionToolPanelProps } from '@thoremin/sdk-ui/types';

export const toolPanelProps = (close: () => void = () => undefined): ExtensionToolPanelProps => ({
  close,
  Sections: () => null,
  raise: () => undefined,
  entryPoints: () => [],
  openEntryPoint: () => undefined,
  openTool: () => undefined,
});
