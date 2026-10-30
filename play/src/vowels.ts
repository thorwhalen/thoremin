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
import { drawFieldOrIdle, planeAspect, skipButton } from './field_page';
import { mountAdjust } from './adjust';
import { SMOOTHING_DEFAULT } from '@thoremin/games/tuning';
import { mountGamePage } from './page';
import type { Session } from './runner';
import { stored } from './stored';
import { mountSpecBar } from './spec_bar';
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
let cursor: VowelCursor | null = null;
let round: ReturnType<typeof createPopSession> | null = null;
const header = document.querySelector('header')!;
const level = () => VOWEL_POP_LEVELS[difficultySel.value as Difficulty];
// The balloons' size is a scale of the difficulty's radius; the smoothing also steadies the free practice dot.
const adjust = mountAdjust({
  game: 'vowels',
  host: header,
  knobs: [
    { key: 'smoothing', label: 'Smoothing', value: SMOOTHING_DEFAULT },
    { key: 'size', label: 'Balloon size', value: 1 },
    { key: 'holdS', label: 'Hold to pop', value: level().holdS },
  ],
  onChange: (v) => {
    cursor?.tune?.({ smoothing: v.smoothing });
    round?.tune({ sizeScale: v.size, holdS: v.holdS });
  },
});
difficultySel.addEventListener('change', () => adjust.setDefault('holdS', level().holdS));
const skip = skipButton($<HTMLButtonElement>('start'), () => round?.skip());

const syncControls = () => {
  difficultySel.hidden = modeSel.value !== 'pop';
  voiceSel.hidden = modeSel.value === 'calibrate';
  skip.hidden = modeSel.value !== 'pop';
};
modeSel.addEventListener('change', syncControls);
syncControls();

// A spec carries the mode, the difficulty, the practice knobs and the vowels of a Vowel Pop round (Vowels plays no songs).
const spec = mountSpecBar({ game: 'vowels', host: header, controls: { mode: modeSel, difficulty: difficultySel, ...adjust.inputs } });

const backdrop = { outline: TRAPEZOID, marks: vowelMarks(), xLabel: 'front ← → back' };
const idle = { game: 'vowels' as const, title: 'Vowels', backdrop, wrapX: false, hint: 'Touch the chart to hear a vowel. Press Start to see yours.' };

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
      round = null;
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
    const v = adjust.values();
    cursor = createVowelCursor({ ...(map ? { calibration: map } : { voice: voiceSel.value as VoiceKind }), smoothing: v.smoothing });
    const pop = modeSel.value === 'pop';
    const lv = level();
    return (round = createPopSession({
      game: 'vowels',
      title: pop ? 'Vowel Pop' : 'Vowels: practice',
      start,
      targets: pop ? vowelCourse({ r: lv.r, seed: Date.now(), ...(spec.settings().vowels?.length ? { vowels: spec.settings().vowels } : {}) }) : [],
      cursor,
      backdrop,
      aspect: planeAspect(canvas),
      atOnce: 1,
      holdS: pop ? (v.holdS ?? lv.holdS) : 1,
      sizeScale: v.size,
      hint: pop ? 'Say the vowel on the balloon, long and steady. Too hard? Skip.' : 'Say a long vowel. Touch the chart to hear one.',
    }));
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
