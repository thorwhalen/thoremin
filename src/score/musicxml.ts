/**
 * MusicXML (`.musicxml`, `.xml`, compressed `.mxl`) → {@link ScoreDoc}, on `musicxml-io`
 * (research map §4.2: MIT, TypeScript, pure JS, handles `.mxl` itself).
 *
 * The route is deliberately through the library's own MIDI export rather than a
 * hand-written walk of its semantic model: `exportMidiWithTimingMap` already resolves
 * divisions, backups, chords, ties, tuplets, repeats and written dynamics (as
 * velocities) into a Standard MIDI File, and pairs it with a timing sidecar that maps
 * MIDI seconds to quarter-note positions and names the expressive regions (fermatas,
 * caesuras). So the MIDI half of the pipeline is shared with `./midi.ts` — one set of
 * note semantics to get right — and what MusicXML adds on top (the title, the written
 * dynamic marks for display, the fermatas as HOLD points for the scheduler) is read
 * from the parsed score and the sidecar. A walk of the model is the fallback the map
 * names if this ever proves lossy; the seam is this one function.
 *
 * This module is the ONLY importer of `musicxml-io` and is reached only by a dynamic
 * `import()` from `./load.ts` (the lazy-loading rule, #188).
 */
import { exportMidiWithTimingMap, getAllPartInfos, getDivisions, getDynamics, parseAuto } from 'musicxml-io/browser';
import { midiToScoreDoc } from './midi';
import { dynamicValue, ScoreDocSchema, type DynamicMark, type ScoreDoc } from './schema';

interface Breakpoint {
  midiSec: number;
  quarterPos: number;
  measureNumber: string;
  beatInMeasure: number;
}

/** MIDI seconds → quarter-note position, linear within the sidecar's segments. */
function quarterAt(breakpoints: readonly Breakpoint[], sec: number): number {
  if (!breakpoints.length) return 0;
  if (sec <= breakpoints[0].midiSec) return breakpoints[0].quarterPos;
  for (let i = 1; i < breakpoints.length; i++) {
    const a = breakpoints[i - 1];
    const b = breakpoints[i];
    if (sec <= b.midiSec) {
      const span = b.midiSec - a.midiSec;
      const f = span > 0 ? (sec - a.midiSec) / span : 0;
      return a.quarterPos + f * (b.quarterPos - a.quarterPos);
    }
  }
  return breakpoints[breakpoints.length - 1].quarterPos;
}

/** The quarter-note position of a measure's start (its first breakpoint), or null. */
function measureStart(breakpoints: readonly Breakpoint[], measureNumber: string): number | null {
  const bp = breakpoints.find((b) => b.measureNumber === measureNumber && b.beatInMeasure === 0) ?? breakpoints.find((b) => b.measureNumber === measureNumber);
  return bp ? bp.quarterPos - bp.beatInMeasure : null;
}

export function musicxmlToScoreDoc(input: Uint8Array | string, title?: string): ScoreDoc {
  const score = parseAuto(input);
  const { midi, sidecar } = exportMidiWithTimingMap(score);
  const base = midiToScoreDoc(midi);

  // Part names: the exporter names tracks from the part list; keep the MusicXML ids
  // alongside so the dynamics below can be attributed to the right part.
  const infos = getAllPartInfos(score);
  const partIdByIndex = new Map<number, string>();
  base.parts.forEach((p, i) => partIdByIndex.set(i, p.id));
  infos.forEach((info, i) => {
    const part = base.parts[i];
    if (part && info.name?.trim()) part.name = info.name.trim();
  });

  const breakpoints = sidecar.breakpoints as Breakpoint[];

  // Fermatas: the sidecar's expressive regions, from MIDI seconds to quarter notes.
  const fermatas: number[] = [];
  for (const e of sidecar.expressions ?? []) {
    if (e.type !== 'fermata') continue;
    const q = quarterAt(breakpoints, e.fromMidiSec);
    if (Number.isFinite(q) && !fermatas.some((f) => Math.abs(f - q) < 1e-6)) fermatas.push(q);
  }
  fermatas.sort((a, b) => a - b);

  // Written dynamics, for display and for the level a part plays at when the source
  // velocities are flat. Position within the measure is in divisions; the measure's
  // start comes from the sidecar.
  const dynamics: DynamicMark[] = [];
  try {
    for (const d of getDynamics(score)) {
      const text = d.dynamic ?? d.otherDynamics;
      if (!text) continue;
      const value = dynamicValue(text);
      if (value === null) continue;
      const start = measureStart(breakpoints, d.measure.number);
      if (start === null) continue;
      let divisions = 1;
      try {
        divisions = getDivisions(score, { part: d.partIndex, measure: d.measureIndex }) || 1;
      } catch {
        divisions = 1;
      }
      dynamics.push({ beat: start + d.position / divisions, part: partIdByIndex.get(d.partIndex), value, text });
    }
  } catch {
    // A score whose dynamics cannot be positioned still plays: velocities carry them.
  }
  dynamics.sort((a, b) => a.beat - b.beat);

  const md = score.metadata;
  const docTitle = title?.trim() || [md.workTitle, md.movementTitle].filter((s) => s && s.trim()).join(' — ') || base.title;
  return ScoreDocSchema.parse({ ...base, source: 'musicxml', title: docTitle, dynamics, fermatas });
}
