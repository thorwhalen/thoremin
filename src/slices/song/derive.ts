/**
 * When the song's branches compose (#600 S15; #186 PR H, #187 PR 7, #380): what core's derivation
 * said about the song, moved with it as the slice's `toolDerive`. The song is a TOOL's need, never
 * the instrument's (its pref is per device, the loaded song transient), so it composes into an
 * instrument's explicit branch set too.
 *
 * - The player (`song-playback`) is not derived: it joins the trunk (`Extension.trunk`), as before.
 * - The pace controller (`song-pace`) composes while the song follows a leader: the dancer (the Song
 *   tool's "Follow the dancer", or a conductor led by a dancer and leading the recording), or a
 *   conductor's beat leading the recording. A conductor's beat wins over the dancer (one leader per
 *   consumer). The conductor is the instrument's: a recording he leads counts only while his branch
 *   is composed.
 * - A dancer leading needs the body's rhythm (`body.rhythm`): whatever measures it is composed with
 *   the pace controller.
 *
 * It reads the conductor's dial (`conductor.enabled` / `conducts` / `source`), core's until S18.
 */
import type { ExtensionDerivationSettings, ToolDeriveContext } from '@thoremin/sdk/instruments/extension';

export const SONG_PLAYBACK_BRANCH = 'song-playback';
export const SONG_PACE_BRANCH = 'song-pace';
/** The groups a dancer leading the song needs (#186 PR H): the pulse, from the body. A group, not
 *  a branch: the branches that measure it are composed with it (#600 S17). */
const DANCER_NEEDS = ['body.rhythm'] as const;

interface SongReads {
  songPrefs?: { follow?: boolean };
  songHandle?: unknown;
  conductor?: { enabled?: boolean; conducts?: string; source?: string };
}

const reads = (s: ExtensionDerivationSettings): SongReads => s as SongReads;

/** Whether the song follows the dancer: following is on and a song is loaded. */
export function songFollows(settings: ExtensionDerivationSettings): boolean {
  const s = reads(settings);
  return s.songPrefs?.follow === true && s.songHandle != null;
}

/** Whether the conductor is on and leads the loaded recording, whoever leads him. */
function conductsRecording(settings: ExtensionDerivationSettings): boolean {
  const s = reads(settings);
  return s.conductor?.enabled === true && s.conductor.conducts === 'recording' && s.songHandle != null;
}

/** Whether the conductor's BEAT leads the recording (#187 PR 7): conducting is on, it conducts the
 *  recording, a song is loaded, and a hand or the body beats (a dancer leading the recording is
 *  {@link songDanced}). It replaces following the dancer. */
export function songConducted(settings: ExtensionDerivationSettings): boolean {
  return conductsRecording(settings) && reads(settings).conductor?.source !== 'dancer';
}

/** Whether the song follows the dancer's pulse (#380: one leader per consumer): the Song tool's
 *  "Follow the dancer", or the conductor led by a dancer and leading the recording. Either way the
 *  pace law follows the pulse, and a conductor's beat leading the recording wins over the Song
 *  tool's pref. */
export function songDanced(settings: ExtensionDerivationSettings): boolean {
  if (songConducted(settings)) return false;
  return songFollows(settings) || conductsRecording(settings);
}

/** The slice's `toolDerive`: the pace controller (and, for a dancer, what measures the body's
 *  rhythm) while a leader leads the song. */
export function deriveSongBranches(settings: ExtensionDerivationSettings, { composed, implying }: ToolDeriveContext): string[] {
  const listed = composed.includes('conductor');
  const conducted = songConducted(settings) && listed;
  // A dancer leads from the Song tool's pref, or through a composed conductor.
  const dancerLeads = !conducted && (songFollows(settings) || (songDanced(settings) && listed));
  return [...(dancerLeads || conducted ? [SONG_PACE_BRANCH] : []), ...(dancerLeads ? implying(DANCER_NEEDS) : [])];
}
