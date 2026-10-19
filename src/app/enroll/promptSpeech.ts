/**
 * The host's spoken prompts for the carve tools (#445), installed on load: the browser's speech
 * synthesis behind the trainer's per-device voice preference (`useVoice`), so one switch is "say
 * things out loud" for the trainer's clips and the quiz alike. The quiz's prompts are the
 * player's own category names, which no cached clip can hold, hence runtime synthesis here and
 * not the clip sink; the sound is the browser's, no key and no cost.
 */
import { providePromptSpeech, type PromptSpeech } from '@thoremin/sdk-ui/enroll/speech';
import { unlockVoice, useVoice } from './voiceRuntime';

/** The browser's synthesizer, or null where there is none. */
function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null;
}

/** The speech the host provides; `speaker` is injectable for tests. */
export function createPromptSpeech(speaker: () => SpeechSynthesis | null = synth): PromptSpeech {
  return {
    get available() {
      return speaker() !== null;
    },
    enabled: () => useVoice.getState().enabled,
    setEnabled(on) {
      if (on) unlockVoice();
      useVoice.getState().setEnabled(on);
      if (!on) this.stop();
    },
    say(text) {
      const s = speaker();
      if (!s || !useVoice.getState().enabled || !text.trim()) return;
      s.cancel();
      s.speak(new SpeechSynthesisUtterance(text));
    },
    stop: () => speaker()?.cancel(),
  };
}

providePromptSpeech(createPromptSpeech());
