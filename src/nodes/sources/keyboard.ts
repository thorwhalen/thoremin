/**
 * `keyboard-source` node (browser-only) — listens to global key events and, on
 * each tick, emits the set of currently `held` keys plus the `pressed` and
 * `released` edge-events that occurred since the previous tick. Downstream
 * `keyboard-control` (or any custom node) interprets these.
 *
 * Edge-events are buffered between ticks and drained on `process`, so no key
 * press is missed even if it happens between frames.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';

const Params = z.object({
  /** Call preventDefault on these keys (e.g. arrows that scroll the page). */
  preventDefaultKeys: z.array(z.string()).default(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']),
});
type Params = z.infer<typeof Params>;

/** True if a key event targets a text-editing surface (an input / textarea / select
 *  or a contenteditable element), where global instrument shortcuts must NOT fire —
 *  e.g. typing a dial name into the command palette. Exported so the palette and the
 *  future hotkey layer share one definition. Tolerant of a non-DOM target (tests). */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export const keyboardSourceNode = defineNode<Params>({
  type: 'keyboard-source',
  roles: ['source'],
  title: 'Keyboard Source',
  description: 'Global keyboard input → held / pressed / released key events.',
  inputs: [],
  outputs: [
    { name: 'held', kind: 'string[]' },
    { name: 'pressed', kind: 'string[]' },
    { name: 'released', kind: 'string[]' },
  ],
  params: Params,
  make(p) {
    const held = new Set<string>();
    let pressedBuf: string[] = [];
    let releasedBuf: string[] = [];
    const prevent = new Set(p.preventDefaultKeys);

    const onDown = (e: KeyboardEvent) => {
      // Don't steal keys the user is typing into a text field or the command
      // palette — otherwise typing a dial name would toggle mute ('m') or shift
      // octave (arrows) on the live instrument. (The later hotkeys phase will want
      // the same guard.) A released key still clears in onUp, so `held` never sticks.
      if (isEditableTarget(e.target)) return;
      if (prevent.has(e.key)) e.preventDefault();
      if (!held.has(e.key)) {
        held.add(e.key);
        pressedBuf.push(e.key); // only the initial press, not auto-repeat
      }
    };
    const onUp = (e: KeyboardEvent) => {
      held.delete(e.key);
      releasedBuf.push(e.key);
    };

    return {
      init(ctx: NodeContext) {
        const target = (ctx.resources.window as Window | undefined) ?? globalThis.window;
        target?.addEventListener('keydown', onDown);
        target?.addEventListener('keyup', onUp);
      },
      process() {
        const out = {
          held: [...held],
          pressed: pressedBuf,
          released: releasedBuf,
        };
        pressedBuf = [];
        releasedBuf = [];
        return out;
      },
      dispose() {
        const target = globalThis.window;
        target?.removeEventListener('keydown', onDown);
        target?.removeEventListener('keyup', onUp);
      },
    };
  },
});
