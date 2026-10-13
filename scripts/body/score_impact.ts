/**
 * The body's anchor detectors on the body fixtures, scored at the beat (#374, A2): the
 * numbers in the A2 PR. One row per fixture and detector: F (±70 ms), F after the
 * anchors' mean lag, R (anchors) and the lag. On the conductor clips the grid IS the
 * beating wrist's strokes (A1), so the stroke detector on that wrist is the reference,
 * and the rows without the wrist are the body's own finding.
 *
 * Usage: npx vite-node scripts/body/score_impact.ts -- [scenario ...]
 */
import { createImpactDetector, createStrokeDetector, type AnchorDetector, type ImpactDetectorOptions } from '@thoremin/ictus';
import { loadClip, syntheticClip, type BodyClip } from './lib_clips';
import { chanceFLag } from './lib_channels';
import { clipFrames, replayAnchors, scoreBeat } from './lib_impact';

const CLIPS = ['video_body_conducting_44', 'video_body_conducting_34', 'video_body_conducting_24', 'video_body_budots', 'video_body_que_calor'];

export const DETECTORS: Array<[string, () => AnchorDetector]> = [
  ['stroke on the wrist', () => createStrokeDetector({ channel: 'wrist' })],
  ['impact, default (wrist, trunk, elbow; select)', () => createImpactDetector()],
  ['impact, weighted', () => createImpactDetector({ combine: 'weighted' })],
  ['impact, wrist', () => createImpactDetector({ joints: ['wrist'] })],
  ['impact, no wrist (trunk, elbow)', () => createImpactDetector({ joints: ['trunk', 'elbow'] })],
  ['impact, trunk', () => createImpactDetector({ joints: ['trunk'] })],
  ['impact, trunk, top', () => createImpactDetector({ joints: ['trunk'], polarity: 'top' })],
  ['impact, trunk, impact event', () => createImpactDetector({ joints: ['trunk'], event: 'impact' } satisfies ImpactDetectorOptions)],
];

function row(clip: BodyClip, name: string, make: () => AnchorDetector): string {
  const s = scoreBeat(clip, replayAnchors(clipFrames(clip), make()));
  return `| ${clip.name} | ${name} | ${s.f.toFixed(2)} | ${s.fLag.toFixed(2)} | ${s.r.toFixed(2)} (${s.n}) | ${s.p < 1e-3 ? '<0.001' : s.p.toFixed(3)} | ${Math.round(s.lagS * 1000)} |`;
}

const names = process.argv.slice(2).filter((a) => a !== '--');
const clips = (names.length ? names : [...CLIPS, 'synthetic']).map((n) => (n === 'synthetic' ? syntheticClip() : loadClip(n)));
console.log('| clip | detector | F | F (lag) | R (anchors) | p | lag ms |\n|---|---|---:|---:|---:|---:|---:|');
for (const clip of clips) {
  for (const [name, make] of DETECTORS) console.log(row(clip, name, make));
  const c = chanceFLag(clip.grid, 0, clip.frames.length / clip.fps);
  console.log(`| ${clip.name} | chance (random, one per beat) | | ${c.median.toFixed(2)} (p95 ${c.p95.toFixed(2)}) | | | |`);
}
