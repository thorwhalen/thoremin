/**
 * The ASL extension's deferred half: its node definitions (and through them the recogniser,
 * `@thoremin/asl`). Never imported statically: the host's build loads it with a dynamic
 * `import()` (the `lazy` entry of `extensions.json`) the first time a graph names
 * `asl-signs` or `sign-chord`, so none of it is in the main chunk
 * (`docs/design/lazy-extensions.md`). The weights are a further lazy hop inside `asl-signs`.
 */
import type { NodeDef } from '@thoremin/dag';
import type { ExtensionNodes } from '@thoremin/sdk/instruments/extension';
import { aslSignsNode } from './nodes/asl_signs';
import { signChordNode } from './nodes/sign_chord';

const ASL_NODES: ExtensionNodes = {
  nodes: [aslSignsNode, signChordNode] as unknown as NodeDef<unknown>[],
};

export default ASL_NODES;
