/**
 * The app shell mounts a surface for every registered tool (#136).
 *
 * The Tools launcher lists every {@link TOOLS} entry (and the bar a button per pinned one)
 * — which means it can offer a tool whose panel nobody mounted, i.e. a button that does
 * nothing. This is
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
  gestures: 'GesturesPanel',
  trainer: 'TrainerPanel',
  conductor: 'ConductorPanel',
  assistant: 'AssistantOverlay',
};

describe('app shell', () => {
  it('renders the ToolsBar and the Tools launcher (the only place a player learns these tools exist)', () => {
    expect(app).toMatch(/<ToolsBar\s*\/>/);
    expect(app).toMatch(/<ToolsLauncher\s*\/>/);
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
