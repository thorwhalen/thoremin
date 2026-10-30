/**
 * Import and export on every funfon page: one bar under the page's controls. **Open a file...**
 * takes a song in any format the music pack reads (MIDI, MusicXML, ABC, the note text, a song as
 * JSON or YAML) or a whole game spec (JSON, YAML, TOML); **Save as...** writes the game (its
 * settings and its song) or just the song. The formats are formatcast's business, loaded from
 * `./formats` on the first click; this module is plain DOM and the games' pure spec helpers.
 *
 * A page hands the bar its controls by setting name (`difficulty` -> the difficulty select) and,
 * if it has one, the select an imported song joins ("Your song: ..."), and asks it back for the
 * song in play (`song()`, null while a shipped one is chosen) and the settings (`settings()`: the
 * controls, plus what a spec set that has no control on the page, such as Echo's stacking).
 *
 * A spec for another game is handed to that game's page (kept in this tab's session storage for
 * the page to pick up), so a shared Pitch Maze opens as a Pitch Maze wherever it was opened.
 */
import type { Song } from '@thoremin/sdk/score/song';
import { gameSpec, songProblem, takesSong, type GameId, type GameSettings, type GameSpec } from '@thoremin/games/spec';

export interface SpecBarOptions {
  game: GameId;
  /** Where the bar goes (the page's header). */
  host: HTMLElement;
  /** The page's controls by setting name; their values are the settings. */
  controls?: Partial<Record<keyof GameSettings, HTMLSelectElement | HTMLInputElement>>;
  /** The select an imported song joins; without one, the bar shows its own. */
  songSelect?: HTMLSelectElement;
  /** The shipped song now chosen, for "Save as" (absent: only an imported one is saved). */
  shippedSong?: () => Song | undefined;
}

export interface SpecBar {
  /** The imported song when it is the one chosen, else null. */
  song(): Song | null;
  settings(): GameSettings;
  /** Apply a spec as if it had been opened (a test, a link). */
  apply(spec: GameSpec): void;
}

const YOURS = '__song';
const PENDING = 'funfon.pendingSpec';
const ACCEPT = '.json,.yaml,.yml,.toml,.mid,.midi,.musicxml,.xml,.mxl,.abc,.notes,.txt';

const NUMERIC: readonly (keyof GameSettings)[] = ['bpm', 'countIn', 'beatsPerBar', 'barsPerPiece', 'passAt', 'retries', 'count', 'size', 'holdS', 'smoothing', 'tolerance'];

export function mountSpecBar(o: SpecBarOptions): SpecBar {
  const bar = document.createElement('div');
  bar.className = 'specbar';
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = 'Open a file...';
  const save = document.createElement('select');
  save.setAttribute('aria-label', 'Save as');
  const status = document.createElement('span');
  status.className = 'hint';
  status.setAttribute('role', 'status');
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = ACCEPT;
  picker.hidden = true;
  bar.append(open, save, status, picker);
  o.host.append(bar);

  // Save as: a placeholder, then the game in each data format, then the song in each of its formats.
  const fill = (formats?: { game: Record<string, string>; song: Record<string, string> }) => {
    save.length = 0;
    save.add(new Option('Save as...', ''));
    const game = formats?.game ?? { json: 'JSON', yaml: 'YAML', toml: 'TOML' };
    const song = formats?.song ?? { midi: 'MIDI', notes: 'note text', json: 'JSON', yaml: 'YAML' };
    for (const [id, label] of Object.entries(game)) save.add(new Option(`This game (${label})`, `game:${id}`));
    if (takesSong(o.game)) for (const [id, label] of Object.entries(song)) save.add(new Option(`The song (${label})`, `song:${id}`));
  };
  fill();

  let imported: Song | null = null;
  let extras: GameSettings = {};
  const own = takesSong(o.game) && !o.songSelect ? document.createElement('select') : null;
  if (own) {
    own.setAttribute('aria-label', 'Song');
    own.add(new Option('Built-in', ''));
    own.hidden = true;
    bar.prepend(own);
  }
  const songSel = o.songSelect ?? own;

  const say = (text: string, error = false) => {
    status.textContent = text;
    status.style.color = error ? '#fbbf24' : '';
  };

  /** Put an imported song aside: the shipped choice is back in play. */
  function dropSong(): void {
    imported = null;
    if (!songSel) return;
    [...songSel.options].filter((x) => x.value === YOURS).forEach((x) => x.remove());
    if (songSel === own) songSel.hidden = true;
    songSel.dispatchEvent(new Event('change'));
  }

  function useSong(song: Song): void {
    imported = song;
    if (!songSel) return;
    [...songSel.options].filter((x) => x.value === YOURS).forEach((x) => x.remove());
    songSel.add(new Option(`Your song: ${song.title ?? 'untitled'}`, YOURS, true, true));
    songSel.value = YOURS;
    songSel.hidden = false;
    songSel.dispatchEvent(new Event('change'));
  }

  function settings(): GameSettings {
    const out: GameSettings = { ...extras };
    for (const [k, el] of Object.entries(o.controls ?? {}) as [keyof GameSettings, HTMLSelectElement | HTMLInputElement][]) {
      if (k === 'lesson' && el.value === YOURS) continue;
      if (NUMERIC.includes(k) && el.value.trim() === '') continue;
      const v = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : NUMERIC.includes(k) ? Number(el.value) : el.value;
      (out as Record<string, unknown>)[k] = v;
    }
    return out;
  }

  function apply(spec: GameSpec): void {
    const problem = spec.song ? songProblem(o.game, spec.song) : null;
    if (problem) return say(`${spec.title ?? 'That game'}: ${problem}`, true);
    // Its song, or none: an earlier imported song does not stay in play under a spec without one.
    if (!spec.song) dropSong();
    extras = { ...spec.settings };
    for (const [k, el] of Object.entries(o.controls ?? {}) as [keyof GameSettings, HTMLSelectElement | HTMLInputElement][]) {
      const v = spec.settings[k];
      if (v === undefined) continue;
      delete (extras as Record<string, unknown>)[k];
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v);
      else if (!(el instanceof HTMLSelectElement) || [...el.options].some((x) => x.value === String(v))) el.value = String(v);
      el.dispatchEvent(new Event('change'));
    }
    if (spec.song) useSong(spec.song);
    say(`Opened ${spec.title ?? 'a game'}${spec.song ? `, with its song (${spec.song.notes.length} notes)` : ''}.`);
  }

  async function onFile(file: File): Promise<void> {
    say(`Reading ${file.name}...`);
    try {
      const io = await import('./formats');
      fill({ game: io.GAME_OUT, song: io.SONG_OUT });
      const read = await io.readFile(file);
      if ('spec' in read) {
        if (read.spec.game !== o.game) {
          try {
            sessionStorage.setItem(PENDING, JSON.stringify(read.spec));
          } catch {
            say(`That is a ${read.spec.game} game: open it on its own page.`, true);
            return;
          }
          location.href = `./${read.spec.game}.html`;
          return;
        }
        apply(read.spec);
        return;
      }
      const problem = songProblem(o.game, read.song);
      if (problem) return say(`${file.name}: ${problem}`, true);
      useSong(read.song);
      say(`${read.song.title ?? file.name}: ${read.song.notes.length} notes${read.song.bpm ? ` at ${Math.round(read.song.bpm)} bpm` : ''}. Press Start.`);
    } catch (e) {
      say(`Could not open ${file.name}: ${(e as Error).message}`, true);
    }
  }

  open.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    const f = picker.files?.[0];
    picker.value = '';
    if (f) void onFile(f);
  });

  save.addEventListener('change', async () => {
    const [as, format] = save.value.split(':') as ['game' | 'song', string];
    save.value = '';
    if (!format) return;
    const song = (songSel?.value === YOURS ? imported : null) ?? o.shippedSong?.();
    const title = song?.title ?? document.title;
    try {
      const io = await import('./formats');
      if (as === 'song' && !song) return say('No song to save: choose or open one.', true);
      const value = as === 'game' ? gameSpec(o.game, settings(), song, title) : song!;
      const file = await io.writeFile(value, as, format, `${title}${as === 'game' ? ` (${o.game})` : ''}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      say(`Saved ${file.name}.`);
    } catch (e) {
      say(`Could not save: ${(e as Error).message}`, true);
    }
  });

  // A spec another page handed over.
  try {
    const raw = sessionStorage.getItem(PENDING);
    const pending = raw ? (JSON.parse(raw) as GameSpec) : null;
    if (pending?.game === o.game) {
      sessionStorage.removeItem(PENDING);
      // Trusted only after the schema has seen it, which needs the lazy half.
      void import('@thoremin/games/spec_schema')
        .then(({ parseGameSpec }) => apply(parseGameSpec(pending)))
        .catch((e: Error) => say(`Could not open the game: ${e.message}`, true));
    }
  } catch {
    // No storage: nothing was handed over.
  }

  const handle: SpecBar = {
    song: () => (songSel?.value === YOURS ? imported : null),
    settings,
    apply,
  };
  (window as unknown as { funfonSpec: SpecBar }).funfonSpec = handle;
  return handle;
}
