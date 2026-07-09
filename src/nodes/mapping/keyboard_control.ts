/**
 * `keyboard-control` node — DEPRECATED (#90). No longer wired into the default
 * app graph: keyboard shortcuts moved to an app-level `tinykeys` handler
 * (`src/app/keyboardShortcuts.ts`) that dispatches DIAL COMMANDS (octave-shift /
 * magnetism are now `master.*` dials), so the single write path is the command
 * registry, not this in-DAG switch. The node + its test are kept as a usable node
 * type; removing it entirely is a follow-up cleanup.
 *
 * It interprets keyboard edge-events into musical control values:
 *
 *   ArrowUp / ArrowDown    → octave shift (±, clamped)
 *   ArrowRight / ArrowLeft → magnetism (more / less scale-snapping)
 *   m                      → toggle mute
 *
 * It is pure (reads a `pressed` string[] input, holds small internal state) so
 * it is unit-testable headlessly — the DOM listening lives in the separate
 * browser-only `keyboard-source` node. This is the computer-keyboard input
 * modality the project wants to keep general alongside video.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';

const Params = z.object({
  magnetismStep: z.number().default(0.1),
  magnetismStart: z.number().min(0).max(1).default(0.8),
  octaveMin: z.number().int().default(-2),
  octaveMax: z.number().int().default(2),
});
type Params = z.infer<typeof Params>;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export const keyboardControlNode = defineNode<Params>({
  type: 'keyboard-control',
  roles: ['mapping', 'control'],
  title: 'Keyboard Control',
  description: 'Keyboard key-press events → octave shift, magnetism, mute.',
  inputs: [{ name: 'pressed', kind: 'string[]', default: [] }],
  outputs: [
    { name: 'octaveShift', kind: 'number' },
    { name: 'magnetism', kind: 'number' },
    { name: 'mute', kind: 'boolean' },
  ],
  params: Params,
  make(p) {
    let octaveShift = 0;
    let magnetism = p.magnetismStart;
    let mute = false;

    return {
      process(inputs) {
        const pressed = (inputs.pressed as string[] | undefined) ?? [];
        for (const key of pressed) {
          switch (key) {
            case 'ArrowUp':
              octaveShift = clamp(octaveShift + 1, p.octaveMin, p.octaveMax);
              break;
            case 'ArrowDown':
              octaveShift = clamp(octaveShift - 1, p.octaveMin, p.octaveMax);
              break;
            case 'ArrowRight':
              magnetism = clamp(magnetism + p.magnetismStep, 0, 1);
              break;
            case 'ArrowLeft':
              magnetism = clamp(magnetism - p.magnetismStep, 0, 1);
              break;
            case 'm':
            case 'M':
              mute = !mute;
              break;
          }
        }
        return { octaveShift, magnetism, mute };
      },
    };
  },
});
