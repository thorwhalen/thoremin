/**
 * The webaudio-synth's pitch memory (#801): the last pitch per voice id, kept past a reaped voice
 * so an id that comes back is rebuilt where it was (#762), is bounded. A score emits one id per
 * note, so the memory used to grow by an entry per note for the whole session.
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import type { SynthParams, VoiceParams } from '@thoremin/sdk/nodes/domain';
import { ABSENT_VOICE_REAP_S, PITCH_MEMORY_CAP, rememberPitch, webAudioSynthNode } from '@/nodes/output/webaudio_synth';
import { fakeAudio, param } from '../helpers/fakeAudio';

describe('rememberPitch', () => {
  it('keeps at most `cap` ids, dropping the one set longest ago', () => {
    const m = new Map<number, number>();
    for (let id = 0; id < 10; id++) rememberPitch(m, id, 100 + id, 4);
    expect([...m.keys()]).toEqual([6, 7, 8, 9]);
    expect(m.get(9)).toBe(109);
  });

  it('an id set again is the most recent, so a sounding voice is never the one dropped', () => {
    const m = new Map<number, number>();
    for (let id = 0; id < 4; id++) rememberPitch(m, id, 100, 4);
    rememberPitch(m, 0, 220, 4); // 0 still sounds
    rememberPitch(m, 99, 100, 4); // a new note: the oldest other than 0 goes
    expect([...m.keys()]).toEqual([2, 3, 0, 99]);
    expect(m.get(0)).toBe(220);
  });
});

describe('the webaudio-synth node with a long score', () => {
  function harness() {
    const fa = fakeAudio({ currentTime: 1 });
    const node = webAudioSynthNode.make(webAudioSynthNode.params.parse({}));
    const ctx = { tick: 0, time: 0, dt: 0, resources: { audioContext: fa.ac, masterGain: fa.master, timeScale: 1 } } as unknown as NodeContext;
    const play = (voices: VoiceParams[]) => node.process!({ params: { voices } satisfies SynthParams }, ctx);
    const voice = (id: number, freq: number): VoiceParams => ({ id, present: true, freq, gain: 0.3, sound: 'sine' });
    /** One note: present for a tick, then gone, then reaped. */
    let now = 1;
    const advance = (dt: number) => fa.setTime((now += dt));
    const note = (id: number, freq: number) => {
      play([voice(id, freq)]);
      advance(0.1);
      play([]);
      advance(ABSENT_VOICE_REAP_S * 20);
      play([]);
    };
    /** Whether `id` comes back anchored at its REMEMBERED pitch `freq` (it is played an octave up, so a
     *  voice anchored at its own new pitch, #734, reads as not remembered). */
    const comesBackAnchored = (id: number, freq: number): boolean => {
      const before = fa.of('Oscillator').length;
      play([voice(id, freq * 2)]);
      const partial = fa.of('Oscillator').slice(before).find((o) => param(o, 'frequency').calls.some((c) => c[0] === 'target'));
      const first = param(partial!, 'frequency').calls[0];
      return first?.[0] === 'set' && first[1] === freq;
    };
    return { note, comesBackAnchored };
  }

  it('a note within the last PITCH_MEMORY_CAP comes back at its pitch; one older than that is forgotten', () => {
    const h = harness();
    h.note(1, 220);
    for (let i = 0; i < PITCH_MEMORY_CAP - 1; i++) h.note(1000 + i, 110 + (i % 50));
    expect(h.comesBackAnchored(1, 220)).toBe(true); // still remembered: exactly the cap
    h.note(2, 330);
    for (let i = 0; i < PITCH_MEMORY_CAP; i++) h.note(5000 + i, 110 + (i % 50));
    expect(h.comesBackAnchored(2, 330)).toBe(false); // pushed out by a full cap of newer notes
  });
});
