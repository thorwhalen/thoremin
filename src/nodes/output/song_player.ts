/**
 * `song-player` node (#186 PR G) — plays the loaded song at a live rate, pitch
 * preserved, into the instrument's master bus. The transport (`playing`), the rate
 * and the level are live input ports; the song itself arrives on the `song` port
 * as the stable {@link SongHandle} the hot store carries, so a new song is detected
 * by identity and loaded once.
 *
 * Playback is behind the {@link Stretcher} seam (`src/song/stretcher.ts`): the
 * native media element by default, injectable through
 * `ctx.resources.createStretcher` (tests, or a host with its own engine). Like
 * every audio node here it is a no-op until the host has an `AudioContext`
 * (created on a user gesture), and it reports where it is on a `status` port in
 * the shared lazy-loading vocabulary (#188): `off` with no song, `loading` while
 * the element buffers, `ready` when playable, `active` while playing.
 *
 * `position` (seconds on the song's own timeline) is emitted every tick for the
 * pace controller (PR H), which needs the song's current beat phase to compare
 * with the dancer's.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import type { LoadStatus } from '@/lazy';
import type { SongHandle } from '@/song/analyze';
import type { Stretcher, StretcherFactory } from '@/song/stretcher';

const Params = z.object({
  /** Hard bounds on the rate a live input can set (the stretcher's quality range). */
  minRate: z.number().positive().default(0.5),
  maxRate: z.number().positive().default(2),
});
type Params = z.infer<typeof Params>;

const OFF: LoadStatus = { phase: 'off', message: 'No song loaded' };

function getAudio(ctx: NodeContext): { ac: AudioContext; master: AudioNode } | null {
  const ac = ctx.resources.audioContext as AudioContext | undefined;
  const master = ctx.resources.masterGain as AudioNode | undefined;
  if (!ac || !master) return null;
  return { ac, master };
}

export const songPlayerNode = defineNode<Params>({
  type: 'song-player',
  roles: ['synth', 'control'],
  title: 'Song Player',
  description: 'Plays the loaded song at a live rate with the pitch preserved, into the master bus; reports its position for the pace controller.',
  inputs: [
    { name: 'song', kind: 'song-handle', description: 'The loaded song (from the Song tool via the store)' },
    { name: 'playing', kind: 'boolean', default: false },
    { name: 'rate', kind: 'number', default: 1, description: 'Playback rate, pitch preserved' },
    { name: 'volume', kind: 'number', default: 0.8 },
  ],
  outputs: [
    { name: 'status', kind: 'load-status' },
    { name: 'position', kind: 'number', description: 'Seconds into the song (its own timeline)' },
  ],
  params: Params,
  make(p) {
    let stretcher: Stretcher | null = null;
    let loadedId: string | null = null;
    let loading = false;
    let failed = false;
    let status: LoadStatus = OFF;

    const ensureStretcher = (ctx: NodeContext): Stretcher | null => {
      if (stretcher) return stretcher;
      const audio = getAudio(ctx);
      if (!audio) return null;
      const factory = ctx.resources.createStretcher as StretcherFactory | undefined;
      if (factory) {
        stretcher = factory({ audioContext: audio.ac, destination: audio.master });
        return stretcher;
      }
      // The default is browser-only (a DOM audio element): load it lazily, once.
      return null;
    };

    const ensureDefault = (ctx: NodeContext): void => {
      if (stretcher || loading) return;
      const audio = getAudio(ctx);
      if (!audio || ctx.resources.createStretcher) return;
      loading = true;
      void import('@/song/stretcher')
        .then(({ createMediaElementStretcher }) => {
          stretcher = createMediaElementStretcher({ audioContext: audio.ac, destination: audio.master });
        })
        .catch((err) => {
          console.warn('[thoremin] song stretcher failed to load', err);
          failed = true;
        })
        .finally(() => {
          loading = false;
        });
    };

    return {
      process(inputs, ctx) {
        const song = inputs.song as SongHandle | null | undefined;
        const playing = inputs.playing === true;
        const rate = typeof inputs.rate === 'number' && Number.isFinite(inputs.rate) ? inputs.rate : 1;
        const volume = typeof inputs.volume === 'number' ? inputs.volume : 0.8;
        if (!song) {
          if (stretcher && loadedId) {
            stretcher.pause();
            loadedId = null;
          }
          status = OFF;
          return { status, position: 0 };
        }
        const s = ensureStretcher(ctx);
        if (!s) {
          ensureDefault(ctx);
          status = failed
            ? { phase: 'error', message: 'The song player could not start' }
            : getAudio(ctx)
              ? { phase: 'loading', message: 'Starting the song player...' }
              : { phase: 'unavailable', reason: 'no-audio', message: 'Start the audio to play the song' };
          return { status, position: 0 };
        }
        if (loadedId !== song.id) {
          loadedId = song.id;
          status = { phase: 'loading', message: `Loading ${song.name}...` };
          void s
            .load(song.url)
            .then(() => {
              if (loadedId === song.id) status = { phase: 'ready', message: `${song.name} ready` };
            })
            .catch(() => {
              if (loadedId === song.id) status = { phase: 'error', message: `${song.name} could not be decoded` };
            });
        }
        s.setVolume(volume);
        s.setRate(Math.max(p.minRate, Math.min(p.maxRate, rate)));
        if (status.phase === 'ready' || status.phase === 'active') {
          if (playing && !s.playing() && !s.ended()) s.play();
          else if (!playing && s.playing()) s.pause();
          status = { ...status, phase: s.playing() ? 'active' : 'ready', message: s.playing() ? `Playing ${song.name}` : `${song.name} ready` };
        }
        return { status, position: s.position() };
      },
      dispose() {
        stretcher?.dispose();
        stretcher = null;
      },
    };
  },
});
