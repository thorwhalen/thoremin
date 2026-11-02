/**
 * The Music tool: what the player says about the music playing, for any source (one with no
 * analysis included): its key, its tempo tapped along, and its chord chart, kept for that piece on
 * this device. Every change is a command (`music.*`). Underneath, what the music is doing now.
 */
import { useState, useSyncExternalStore } from 'react';
import { controls } from '@thoremin/sdk-ui/host';
import { dispatchCommand } from '@thoremin/sdk-ui/dials';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { KEY_MODES } from '@thoremin/sdk/score/schema';
import { NOTES } from '@thoremin/sdk/music/theory';
import { parseChart } from '@thoremin/sdk/context/from_user';
import { currentEntry, pieceKey } from '../app/user';
import { MusicContextReadout } from './MusicContextSection';

const subscribe = (l: () => void) => controls().subscribe(l);
/** The entry for the piece now, as a string (a stable snapshot for React). */
const entryJson = () => JSON.stringify({ piece: pieceKey(), entry: currentEntry() });

const PIECE_WORDS = (key: string) => (key.startsWith('score:') ? `the score "${key.slice(6)}"` : key.startsWith('file:') ? `"${key.slice(5)}"` : key ? 'the song playing' : '');

export function MusicTool() {
  const { piece, entry } = JSON.parse(useSyncExternalStore(subscribe, entryJson, entryJson)) as { piece: string; entry: ReturnType<typeof currentEntry> };
  const [chart, setChart] = useState(entry.chart);
  const [message, setMessage] = useState<string | null>(null);
  const report = async (id: string, params: Record<string, unknown> = {}, done?: (value: unknown) => string) => {
    const r = await dispatchCommand(id, params);
    setMessage(r.ok ? (done ? done(r.value) : null) : r.error.message);
  };
  const errors = parseChart(chart).errors;

  if (!piece) {
    return (
      <p className="text-xs text-white/60" data-testid="music-tool-empty">
        Load something to play along to first: a song in the Song tool, or a piece in the Conductor. Then say its key, tap its tempo, or write its chords here.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-xs" data-testid="music-tool">
      <p className="text-white/60">About {PIECE_WORDS(piece)}: kept on this device for this piece.</p>
      <div className="flex items-center justify-between gap-2">
        <span>Key</span>
        <span className="flex gap-1">
          <select className={selectCls} aria-label="Key note" value={entry.key ? String(entry.key.tonic) : ''} onChange={(e) => void (e.target.value === '' ? report('music.key.clear') : report('music.key.set', { tonic: Number(e.target.value), mode: entry.key?.mode ?? 'major' }))}>
            <option value="">from the music</option>
            {NOTES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
          <select className={selectCls} aria-label="Key mode" value={entry.key?.mode ?? 'major'} disabled={!entry.key} onChange={(e) => void report('music.key.set', { tonic: entry.key!.tonic, mode: e.target.value })}>
            {KEY_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span>Tempo {entry.tempo ? <b data-testid="music-tempo">{Math.round(entry.tempo.bpm)} bpm</b> : <span className="text-white/50">(the song's own)</span>}</span>
        <span className="flex gap-1">
          <button type="button" className="rounded bg-white/15 px-3 py-1 hover:bg-white/25" onClick={() => void report('music.tempo.tap', {}, (v) => ((v as { bpm?: number }).bpm ? `${Math.round((v as { bpm: number }).bpm)} bpm` : `${(v as { taps: number }).taps} taps: keep going`))}>
            Tap
          </button>
          {entry.tempo && (
            <button type="button" className="rounded bg-white/5 px-2 py-1 hover:bg-white/15" onClick={() => void report('music.tempo.clear')}>
              Forget
            </button>
          )}
        </span>
      </div>
      <label className="block space-y-1">
        <span>Chords, bar by bar</span>
        <textarea className="h-20 w-full rounded bg-white/10 p-2 font-mono" aria-label="Chord chart" placeholder="C | F G | Am | G7" value={chart} onChange={(e) => setChart(e.target.value)} />
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className="text-rose-300">{errors.length ? `Not chords: ${errors.slice(0, 4).join(', ')}` : ''}</span>
        <button type="button" className="rounded bg-white/15 px-3 py-1 hover:bg-white/25 disabled:opacity-40" disabled={errors.length > 0 || chart === entry.chart} onClick={() => void report('music.chart.set', { chart }, () => 'Chart saved')}>
          Save chart
        </button>
      </div>
      {message && <p className="text-white/70" data-testid="music-tool-message">{message}</p>}
      <MusicContextReadout />
    </div>
  );
}
