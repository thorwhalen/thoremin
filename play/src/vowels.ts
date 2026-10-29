/**
 * Vowels on a page of its own (`play/vowels.html`): the IPA vowel trapezoid, playable and
 * listening. Touch or click it and a formant synthesiser (`./vowel_synth`) sounds the vowel drawn
 * there, gliding as the finger moves (the chart's map inverted, `formantsAt`). Start, and the
 * microphone's formants (the `formants` analyser) put the voice on it as a dot (`createVowelCursor`):
 * in Practice, freely, with the nearest vowel named; in Vowel Pop, the eight primary cardinal
 * vowels are balloons to hold the dot on. Vowel Pop is `@thoremin/games`' pop over the vowel
 * cursor: the same session as Pop the Notes. Your vowels (`createVowelCalibration`) asks for "ee",
 * "oo" and "ah", fits the chart to the player's own vowel space and keeps it in this browser
 * (`./stored`); while one is kept, it is the voice the dot follows ("Voice: yours").
 */
import { DIFFICULTIES, type Difficulty } from '@thoremin/games/difficulty';
import { FORMANT_ANALYSERS } from '@thoremin/games/listen';
import { createPopSession } from '@thoremin/games/pop';
import { fieldLayout } from '@thoremin/games/field_stage';
import { text } from '@thoremin/games/stage';
import type { FieldView } from '@thoremin/games/field';
import { createVowelCalibration } from '@thoremin/games/vowel_calibration';
import { createVowelCursor, formantsAt, nearestVowel, TRAPEZOID, VOICE_SCALES, VOWEL_POP_LEVELS, vowelCourse, vowelMarks, type VoiceKind, type VoiceMap, type VowelCursor } from '@thoremin/games/vowels';
import { drawFieldOrIdle, planeAspect } from './field_page';
import { mountGamePage } from './page';
import type { Session } from './runner';
import { stored } from './stored';
import { createVowelSynth, type VowelSynth } from './vowel_synth';

const MODES = { practice: 'Practice', pop: 'Vowel Pop', calibrate: 'Your vowels (calibrate)' } as const;
const VOICES: Record<VoiceKind, string> = { auto: 'Voice: auto', lower: 'Voice: lower', higher: 'Voice: higher', child: 'Voice: child' };
const YOURS = 'yours';

const isVoiceMap = (v: unknown): v is VoiceMap => {
  const m = v as VoiceMap;
  return !!m && Array.isArray(m.b1) && Array.isArray(m.b2) && [...m.b1, ...m.b2].length === 6 && [...m.b1, ...m.b2].every(Number.isFinite);
};
const calibration = stored<VoiceMap>('funfon.vowelCalibration', isVoiceMap);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('stage');
const modeSel = $<HTMLSelectElement>('mode');
const difficultySel = $<HTMLSelectElement>('difficulty');
const voiceSel = $<HTMLSelectElement>('voice');
for (const [k, label] of Object.entries(MODES)) modeSel.add(new Option(label, k));
for (const d of DIFFICULTIES) difficultySel.add(new Option(d, d, d === 'normal', d === 'normal'));
function fillVoices(): void {
  voiceSel.length = 0;
  const yours = calibration.read() !== null;
  if (yours) voiceSel.add(new Option('Voice: yours', YOURS, true, true));
  for (const [k, label] of Object.entries(VOICES)) voiceSel.add(new Option(label, k, !yours && k === 'auto', !yours && k === 'auto'));
}
fillVoices();
const syncControls = () => {
  difficultySel.hidden = modeSel.value !== 'pop';
  voiceSel.hidden = modeSel.value === 'calibrate';
};
modeSel.addEventListener('change', syncControls);
syncControls();

const backdrop = { outline: TRAPEZOID, marks: vowelMarks(), xLabel: 'front ← → back' };
const idle = { game: 'vowels' as const, title: 'Vowels', backdrop, wrapX: false, hint: 'Touch the chart to hear a vowel. Press Start to see yours.' };

let cursor: VowelCursor | null = null;
let synth: VowelSynth | null = null;
/** Where the finger is on the plane while it sounds a vowel. */
let touch: { x: number; y: number } | null = null;

const page = mountGamePage<FieldView>({
  canvas,
  startButton: $<HTMLButtonElement>('start'),
  analysers: FORMANT_ANALYSERS,
  session: (start): Session<FieldView> => {
    if (modeSel.value === 'calibrate') {
      cursor = null;
      const cal = createVowelCalibration({ start, backdrop });
      let saved = false;
      return {
        tick(now, heard) {
          const out = cal.tick(now, heard);
          const map = cal.result();
          if (map && !saved) {
            saved = true;
            calibration.write(map);
            fillVoices();
          }
          return out;
        },
      };
    }
    const map = voiceSel.value === YOURS ? calibration.read() : null;
    cursor = createVowelCursor(map ? { calibration: map } : { voice: voiceSel.value as VoiceKind });
    const pop = modeSel.value === 'pop';
    const level = VOWEL_POP_LEVELS[difficultySel.value as Difficulty];
    return createPopSession({
      game: 'vowels',
      title: pop ? 'Vowel Pop' : 'Vowels: practice',
      start,
      targets: pop ? vowelCourse({ r: level.r, seed: Date.now() }) : [],
      cursor,
      backdrop,
      aspect: planeAspect(canvas),
      atOnce: 1,
      holdS: pop ? level.holdS : 1,
      hint: pop ? 'Say the vowel on the balloon, long and steady.' : 'Say a long vowel. Touch the chart to hear one.',
    });
  },
  draw: (g, W, H, view) => {
    drawFieldOrIdle(g, W, H, view, idle);
    const L = fieldLayout({ W, H });
    if (view?.cursor?.live && view.targets.length === 0) {
      const q = L.px(view.cursor);
      text(g, `[${nearestVowel(view.cursor).ipa}]`, q.x + 18, q.y - 18, 20, '#e0f2fe');
    }
    if (touch) {
      const q = L.px(touch);
      g.strokeStyle = '#f5d142';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(q.x, q.y, 16, 0, Math.PI * 2);
      g.stroke();
      text(g, `[${nearestVowel(touch).ipa}]`, q.x, q.y - 30, 18, '#f5d142', 'center');
    }
  },
  over: (view) => view.phase === 'results',
});

/** The plane point under a pointer, or null outside the plane. */
function planePoint(e: PointerEvent): { x: number; y: number } | null {
  const r = canvas.getBoundingClientRect();
  const L = fieldLayout({ W: r.width, H: r.height });
  const x = (e.clientX - r.left - L.left) / L.bw;
  const y = (L.bottom - (e.clientY - r.top)) / L.bh;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

const voiceScale = () => (voiceSel.value === 'auto' || voiceSel.value === YOURS ? (cursor?.scale() ?? 1) : VOICE_SCALES[voiceSel.value as Exclude<VoiceKind, 'auto'>]);

canvas.addEventListener('pointerdown', async (e) => {
  const p = planePoint(e);
  if (!p) return;
  canvas.setPointerCapture(e.pointerId);
  touch = p;
  const ctx = await page.ensureAudio();
  synth ??= createVowelSynth(ctx, ctx.destination, { pitchHz: 130 * voiceScale(), voiceScale: voiceScale() });
  if (touch) synth.play(formantsAt(touch, voiceScale()));
});
canvas.addEventListener('pointermove', (e) => {
  if (!touch) return;
  const p = planePoint(e);
  if (!p) return;
  touch = p;
  synth?.play(formantsAt(p, voiceScale()));
});
const release = () => {
  touch = null;
  synth?.stop();
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
