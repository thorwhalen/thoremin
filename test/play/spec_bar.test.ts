// @vitest-environment jsdom
/**
 * The import and export bar every funfon page carries (`play/src/spec_bar.ts`): a song file joins
 * the page's song select and becomes the song in play; a game spec sets the page's controls and
 * keeps the settings it has no control for; a song a game cannot play is refused in words; a spec
 * for another game is handed to that game's page.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountSpecBar } from '../../play/src/spec_bar';
import { gameSpec } from '@thoremin/games/spec';
import { songFromText } from '@thoremin/sdk/score/song';

function page() {
  document.body.innerHTML = '<header><select id="lesson"><option value="a">Shipped A</option></select><select id="difficulty"><option>easy</option><option selected>normal</option><option>hard</option></select></header>';
  const lesson = document.getElementById('lesson') as HTMLSelectElement;
  const difficulty = document.getElementById('difficulty') as HTMLSelectElement;
  return { lesson, difficulty, header: document.querySelector('header')! };
}

/** Open a file through the bar's hidden picker, and wait until its status line has the outcome. */
async function open(file: File): Promise<string> {
  const input = document.querySelector('.specbar input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  const status = document.querySelector('.specbar [role=status]')!;
  for (let i = 0; i < 200 && /^Reading|^$/.test(status.textContent ?? ''); i++) await new Promise((r) => setTimeout(r, 10));
  return status.textContent ?? '';
}

// jsdom's Blob predates arrayBuffer(), which every browser funfon runs in has (formatcast reads files with it).
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
}

beforeEach(() => sessionStorage.clear());

describe('the spec bar', () => {
  it('opens a song file: it joins the song select, chosen, and is the song in play', async () => {
    const { lesson, difficulty, header } = page();
    const bar = mountSpecBar({ game: 'sing-along', host: header, controls: { difficulty, lesson }, songSelect: lesson });
    expect(bar.song()).toBeNull();
    const said = await open(new File(['bpm=80 C4 D4 E4:2'], 'little tune.notes'));
    expect(said).toBe('little tune: 3 notes at 80 bpm. Press Start.');
    expect(lesson.selectedOptions[0].textContent).toBe('Your song: little tune');
    expect(bar.song()!.notes.map((n) => n.midi)).toEqual([60, 62, 64]);
    // Choosing the shipped one again puts the imported one aside.
    lesson.value = 'a';
    expect(bar.song()).toBeNull();
    expect(bar.settings()).toEqual({ difficulty: 'normal', lesson: 'a' });
  });

  it('refuses a rhythm where a melody is needed, in words', async () => {
    const { lesson, header } = page();
    const bar = mountSpecBar({ game: 'pitch-maze', host: header, controls: { lesson }, songSelect: lesson });
    expect(await open(new File(['x x x x'], 'beat.notes'))).toMatch(/needs a melody/);
    expect(bar.song()).toBeNull();
  });

  it('opens a game spec: its controls set, its other settings kept, its song in play', async () => {
    const { lesson, difficulty, header } = page();
    const bar = mountSpecBar({ game: 'echo', host: header, controls: { difficulty, lesson }, songSelect: lesson });
    const spec = gameSpec('echo', { difficulty: 'hard', stack: 'grow', passAt: 0.9 }, songFromText('x x x:2', 'Clap'), 'Mine');
    const said = await open(new File([JSON.stringify(spec)], 'mine.json'));
    expect(said).toMatch(/^Opened Mine, with its song/);
    expect(difficulty.value).toBe('hard');
    expect(bar.settings()).toMatchObject({ difficulty: 'hard', stack: 'grow', passAt: 0.9 });
    expect(bar.song()!.title).toBe('Clap');
  });

  it('hands a spec for another game to that game\'s page', async () => {
    const { lesson, header } = page();
    mountSpecBar({ game: 'echo', host: header, controls: { lesson }, songSelect: lesson });
    await open(new File(['kind: funfon-game\nversion: 1\ngame: pitch-maze\nsettings:\n  track: road\n'], 'maze.yaml'));
    expect(JSON.parse(sessionStorage.getItem('funfon.pendingSpec')!).game).toBe('pitch-maze');
  });

  it('a page without a song select gets its own, shown once a song is opened', async () => {
    const { difficulty, header } = page();
    const bar = mountSpecBar({ game: 'pop-the-notes', host: header, controls: { difficulty } });
    const own = document.querySelector('.specbar select[aria-label=Song]') as HTMLSelectElement;
    expect(own.hidden).toBe(true);
    await open(new File(['C4 E4 G4'], 'triad.notes'));
    expect(own.hidden).toBe(false);
    expect(bar.song()!.notes).toHaveLength(3);
  });
});
