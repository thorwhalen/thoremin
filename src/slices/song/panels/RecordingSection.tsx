/**
 * "Conduct a recording" (#187 PR 7) as the song slice's section in the Conductor panel (#600 S15:
 * `ExtensionUi.toolSections`): choose the recording, say on which song beat the conductor's first
 * beat lands, and read what the beat servo is doing. The Conductor's Start and Stop reach it inside
 * the click ({@link recordingStart}, {@link recordingStop}): Start unlocks the media element's
 * playback (its autoplay policy; the Signalsmith worklet needs none), Stop hands the song back to the
 * Song tool, paused, not to whatever its transport said before the conductor took it.
 */
import { useRef, useState } from 'react';
import type { LoadStatus } from '@thoremin/lazy';
import type { ToolSectionContext } from '@thoremin/sdk-ui/types';
import { dispatchCommand } from '@thoremin/sdk-ui/dials';
import { unlockSongPlayback } from '../nodes/song_player.schema';
import { loadSongFile } from '../app/host';
import { useSongStatus, type ServoReadout } from '../app/songStatus';
import { songHandle, songStartBeat, useSongField } from '../app/state';
import { SONG_START_BEAT_MAX } from '../schema';

const recording = (c: ToolSectionContext): boolean => c['conductor.conducts'] === 'recording';

/** Start conducting, inside the click: unlock the song's playback before the tick that plays it. */
export function recordingStart(c: ToolSectionContext): void {
  if (recording(c)) unlockSongPlayback();
}

/** Stop conducting: the song goes back to the Song tool, paused. */
export function recordingStop(c: ToolSectionContext): void {
  if (recording(c)) void dispatchCommand('song.pause', {});
}

/** What the recording is doing while the beat leads it (#187 PR 7). */
export function describeRecording(rec: ServoReadout | null, status?: LoadStatus): string {
  if (!rec || rec.mode === 'idle') {
    // The servo leads no song that is not playable yet (#500): say why, from the player's own status (#502).
    if (status?.phase === 'loading' || status?.phase === 'error') return status.message;
    if (status?.phase === 'unavailable' && status.reason === 'no-audio') return 'Tap to play, then beat.';
    return 'The recording has no beat to follow.';
  }
  if (rec.mode === 'cueing') return 'The recording waits on its first beat for yours.';
  if (rec.mode === 'holding') return 'The recording waits for your next beat.';
  const off = Math.round(rec.error * 100);
  return `Playing at ${Math.round(rec.rate * 100)} % speed, ${off === 0 ? 'on your beat' : `${Math.abs(off)} % of a beat ${off > 0 ? 'ahead' : 'behind'}`}.`;
}

/** The Conductor's second mode: the beat leads a recording (#187 PR 7). Shown by the Conductor
 *  panel while it conducts a recording; `conductor.enabled` comes from its context. */
export function RecordingSection({ context }: { context: ToolSectionContext }) {
  const conducting = context['conductor.enabled'] === true;
  const song = useSongField(songHandle);
  const songLoad = useSongStatus((s) => s.status);
  const songBeat = useSongStatus((s) => s.live.beat);
  const servo = useSongStatus((s) => s.servo);
  const startBeat = useSongField(songStartBeat);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await loadSongFile(file);
    } catch {
      setError(`${file.name} could not be decoded. Try an MP3, M4A, WAV, OGG or FLAC file.`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-2 text-xs" data-testid="conductor-recording">
      <input ref={fileRef} type="file" accept="audio/*" className="hidden" data-testid="conductor-recording-file" onChange={(e) => void onFile(e.target.files?.[0])} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="w-full rounded bg-white/10 px-2 py-1.5 font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
      >
        {busy ? 'Finding the beat...' : song ? 'Choose another recording...' : 'Choose a recording...'}
      </button>
      {error && <p className="text-[11px] text-amber-300/90">{error}</p>}
      {song ? (
        <>
          <div className="truncate text-white/80" title={song.name}>{song.name}</div>
          <div className="flex items-center justify-between gap-2 text-white/80" data-testid="conductor-start-beat">
            <label className="flex items-center gap-1.5">
              My first beat lands on song beat
              <input
                type="number"
                min={0}
                max={SONG_START_BEAT_MAX}
                step={1}
                value={startBeat}
                aria-label="Song beat the conductor's first beat lands on"
                className="w-16 rounded bg-white/10 px-1 py-0.5 text-right font-mono"
                onChange={(e) => void dispatchCommand('song.startBeat.set', { beat: Math.min(SONG_START_BEAT_MAX, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
              />
            </label>
            <button
              onClick={() => void dispatchCommand('song.startBeat.set', { beat: Math.max(0, songBeat) })}
              title="Play the song in the Song tool and press this where the piece starts"
              className="rounded bg-white/10 px-2 py-0.5 font-semibold text-white/80 transition hover:bg-white/20"
            >
              Here
            </button>
          </div>
          {conducting && <div className="text-white/60" data-testid="conductor-recording-live">{describeRecording(servo, songLoad)}</div>}
        </>
      ) : (
        <p className="text-white/50">Any song: its beat is found when it loads, and it follows yours.</p>
      )}
    </div>
  );
}
