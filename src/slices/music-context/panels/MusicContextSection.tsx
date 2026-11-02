/**
 * The editor's Music section: whether the instrument's scale follows the music playing, how a key
 * sets it, and what the music is doing now (its key and chord). Every control writes through the
 * dial write path (`dispatchDialSetIn`).
 */
import { dispatchDialSetIn, useDialsSettings } from '@thoremin/sdk-ui/dials';
import { selectCls } from '@thoremin/sdk-ui/primitives';
import { useMusicContextStatus } from '../app/status';
import { useActiveContext } from '../app/active';
import { DEFAULT_MUSIC_CONTEXT, MUSIC_CONTEXT_DIAL, type MusicContextSettings } from '../schema';

const SOURCE_WORDS: Record<string, string> = { score: 'the score', user: 'your chart', 'audio-estimate': 'the recording', 'score-aligned': 'the score, aligned to the recording' };
const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the music is doing, in a line. */
export function MusicContextReadout() {
  const status = useMusicContextStatus((s) => s.status);
  const loaded = useActiveContext();
  if (!status.active) {
    const what = loaded ? `${capitalised(SOURCE_WORDS[loaded.context.source] ?? 'the music')} is loaded, with ${loaded.context.keys.length || 'no'} key${loaded.context.keys.length === 1 ? '' : 's'}.` : 'No music with a key yet: load a piece in the Conductor.';
    return (
      <p className="text-[11px] text-white/50" data-testid="music-context-readout" data-key="">
        {what}
      </p>
    );
  }
  const what = [status.key, status.chord && `chord ${status.chord}`].filter(Boolean).join(', ');
  return (
    <p className="text-[11px] text-white/70" data-testid="music-context-readout" data-key={status.key ?? ''} data-owns={status.ownsScale ? 'yes' : 'no'}>
      From {SOURCE_WORDS[status.source ?? ''] ?? 'the music'}: {what || 'no key written'}
      {status.moving ? '' : ' (waiting for the music to play)'}
      {status.ownsScale ? '. The scale follows it.' : '.'}
    </p>
  );
}

export function MusicContextControls() {
  const { state } = useDialsSettings();
  const c = { ...DEFAULT_MUSIC_CONTEXT, ...((state.effective[MUSIC_CONTEXT_DIAL] ?? {}) as Partial<MusicContextSettings>) };
  return (
    <div className="space-y-2" data-testid="music-context-controls">
      <label className="flex items-center justify-between gap-2 text-xs">
        Scale from
        <select className={selectCls} value={c.scaleFrom} aria-label="Scale from" onChange={(e) => dispatchDialSetIn(`${MUSIC_CONTEXT_DIAL}.scaleFrom`, e.target.value)}>
          <option value="dials">These settings</option>
          <option value="music">The music playing</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs">
        Fit to the key
        <select className={selectCls} value={c.fit} disabled={c.scaleFrom !== 'music'} aria-label="Fit to the key" onChange={(e) => dispatchDialSetIn(`${MUSIC_CONTEXT_DIAL}.fit`, e.target.value)}>
          <option value="flavour">Keep this scale's kind</option>
          <option value="key">The key's own scale</option>
        </select>
      </label>
      <MusicContextReadout />
    </div>
  );
}
