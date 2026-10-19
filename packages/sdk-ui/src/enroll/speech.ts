/**
 * Spoken prompts for a carve tool, as a seam (#445): the quiz says the face to make ("frown",
 * "relax") so the player need not read the panel while making faces.
 *
 * A prompt is the player's own word for a category, so it cannot be one of the trainer's cached
 * clips (`speakable.ts`: a finite starter set made ahead of time). The host provides how to say
 * one (the browser's speech synthesis, behind the same per-device voice preference the trainer's
 * clips use) and an extension only asks. With nothing provided, or voice off, a prompt is silent
 * and the written one carries on.
 */

/** What the host offers the tool. */
export interface PromptSpeech {
  /** Whether the player has voice on (the per-device preference) and the browser can speak. */
  readonly available: boolean;
  /** Whether prompts are spoken now. */
  enabled(): boolean;
  /** Turn spoken prompts on or off (call inside a click: a browser lifts its autoplay gate there). */
  setEnabled(on: boolean): void;
  /** Say `text`, cutting off a prompt still being spoken. */
  say(text: string): void;
  /** Silence a prompt in flight. */
  stop(): void;
}

let current: PromptSpeech | null = null;

/** Provide (or with null, withdraw) the host's speech. Returns a withdraw for THIS one only. */
export function providePromptSpeech(speech: PromptSpeech | null): () => void {
  current = speech;
  return () => {
    if (current === speech) current = null;
  };
}

/** The host's speech, or null where there is none (a test, a browser that cannot speak). */
export function promptSpeech(): PromptSpeech | null {
  return current?.available ? current : null;
}
