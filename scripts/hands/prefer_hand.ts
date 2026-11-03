/**
 * Print what the preferred-hand rule (#784) does on the recorded conducting hands: for each fixture,
 * preference and landmarker behaviour, the share of two-hands-in-view frames where a one-hand reader
 * gets the hand it wants, with and without the rule, and what the rule costs (frames at two hands,
 * the search share, count changes a minute). `npx vite-node scripts/hands/prefer_hand.ts`.
 */
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { PREFER_HIGHER_HAND, type HandPreference } from '@thoremin/sdk/nodes/player_hands';
import { loadStream } from '../../test/helpers/fixtures';
import { runPreference, SWITCH_ABOUT_EVERY_SECOND } from './lib_prefer_hand';

/** The recorded hands of a conductor, both hands often in view, at their own frame rates. */
const FIXTURES: readonly { scenario: string; fps: number }[] = [
  { scenario: 'conducting_44', fps: 30 },
  { scenario: 'conducting_34', fps: 30 },
  { scenario: 'conducting_24', fps: 30 },
  { scenario: 'real_hands_choir', fps: 29.97 },
];
const PREFERENCES: readonly [string, HandPreference][] = [
  ['label Right', { kind: 'label', handedness: 'Right' }],
  ['label Left', { kind: 'label', handedness: 'Left' }],
  ['higher', PREFER_HIGHER_HAND],
];
const LANDMARKERS = [
  ['holds', { switchPerFrame: 0 }],
  ['switches ~1/s', { switchPerFrame: SWITCH_ABOUT_EVERY_SECOND }],
] as const;

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

console.log('fixture | preference | landmarker | 2-in-view | wanted without | wanted with | at two | search | changes/min');
for (const { scenario, fps } of FIXTURES) {
  const frames = loadStream(scenario, 'src.hands') as HandsFrame[];
  for (const [name, preference] of PREFERENCES) {
    for (const [lm, landmarker] of LANDMARKERS) {
      const off = runPreference(frames, preference, { fps, rule: false, landmarker });
      const on = runPreference(frames, preference, { fps, rule: true, landmarker });
      console.log([scenario, name, lm, `${on.twoInView}/${on.frames}`, pct(off.wantedShare), pct(on.wantedShare), pct(on.atTwoShare), pct(on.searchShare), on.changesPerMinute.toFixed(1)].join(' | '));
    }
  }
}
