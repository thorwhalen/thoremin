/**
 * The carve host (#385 E2) — what the carve command (`./carve`) acts on, by dependency
 * inversion, the shape of `./songHost`.
 *
 * A carve tool's live take (exploring, resting, capturing or paused) is an extension's session
 * state, which a command may not import (`test/commands_firewall.test.ts`) and the host cannot
 * name. So the app installs a host that reads the live take's control from the SDK's capture
 * seam (`src/app/carveCapture.ts`), and the command resolves it at dispatch time. No live take
 * is an ordinary state, not a missing seam: the host then returns null.
 */

/** Where a live carve is (the SDK's `CaptureState`, restated: a command imports only siblings). */
export type CarveCaptureState = 'explore' | 'rest' | 'capturing' | 'paused';

export interface CarveControl {
  /** What is being carved, for a message (`faces`). */
  readonly what: string;
  state(): CarveCaptureState;
  toggle(): void;
}

export interface CarveHost {
  /** The live carve's control, or null when no carve tool is reading the camera. */
  control(): CarveControl | null;
}

let host: CarveHost | null = null;

/** Installed by `src/app/carveCapture.ts` when the app loads. */
export function provideCarveHost(next: CarveHost | null): void {
  host = next;
}

/** The live carve's control, or null (no host installed, or no carve live). */
export function liveCarve(): CarveControl | null {
  return host?.control() ?? null;
}
