/**
 * The app shell mounts a surface for every registered tool (#136).
 *
 * `ToolsBar` renders a button per {@link TOOLS} entry — which means it can render a
 * button for a tool whose panel nobody mounted, i.e. a button that does nothing. This is
 * the guard against that, and against the shell quietly dropping the tools bar itself.
 *
 * It is a SOURCE check rather than a render: mounting App boots the webcam and the ML
 * engine, which no unit test should do. The rendering half of the chain (button → open
 * state → panel) is covered in `tools_shell.test.tsx`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOLS } from '@/app/tools';

const app = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');

/** The component that renders each non-link tool's surface. A tool with no entry here
 *  fails the test below — registering a tool obliges you to give it a home. */
const SURFACES: Record<string, string> = {
  lab: 'LabPanel',
  commands: 'CommandPaletteOverlay',
};

describe('app shell', () => {
  it('renders the ToolsBar (the only place a player learns these tools exist)', () => {
    expect(app).toMatch(/<ToolsBar\s*\/>/);
  });

  it('mounts a surface component for every non-link tool', () => {
    for (const tool of TOOLS) {
      if (tool.kind === 'link') continue;
      const component = SURFACES[tool.id];
      expect(component, `tool '${tool.id}' has no surface listed in SURFACES`).toBeTruthy();
      expect(app, `App.tsx does not mount <${component} /> for tool '${tool.id}'`).toContain(
        `<${component} />`,
      );
    }
  });
});
