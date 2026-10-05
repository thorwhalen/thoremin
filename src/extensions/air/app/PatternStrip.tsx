/**
 * The pattern strip (#269): the score as a drummer reads it, one row per drum, one cell
 * per subdivision, with a cursor.
 *
 * Drawn in the panel, not on the video (the design's reason: the video already carries
 * the pads, and a second moving thing there is clutter). The cursor is a position in
 * beats, wrapped to the pattern's length, so the caller may drive it from the count-in's
 * clock or from a follower. Cells that a fitted model found late or early can be tinted
 * by the caller through `shade`. Pure SVG.
 */
import type { DrumPattern } from '@thoremin/sdk/music/drum_patterns';
import { patternDrums } from '@thoremin/sdk/drums/pattern_fit';
import { DRUM_SOUND } from '@thoremin/sdk/music/gm_drums';

export interface PatternStripProps {
  pattern: DrumPattern;
  /** Cursor position in beats from the pattern's start; null hides it. */
  cursorBeat?: number | null;
  /** A colour per event index, for a fitted model's verdicts. */
  shade?: (eventIndex: number) => string | undefined;
  width?: number;
}

const ROW_H = 14;
const LABEL_W = 44;
const DRUM_LABEL: Record<string, string> = { kick: 'kick', snare: 'snare', hihat: 'hat', openHihat: 'open', tom: 'tom', floorTom: 'floor', crash: 'crash', ride: 'ride' };

export function PatternStrip({ pattern, cursorBeat = null, shade, width = 320 }: PatternStripProps) {
  const drums = patternDrums(pattern);
  const cellW = (width - LABEL_W) / pattern.steps;
  const height = drums.length * ROW_H + 4;
  const cursorX = cursorBeat === null ? null : LABEL_W + (((cursorBeat % pattern.lengthBeats) + pattern.lengthBeats) % pattern.lengthBeats) * pattern.stepsPerBeat * cellW;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${pattern.name}: ${pattern.steps} steps`} data-testid="pattern-strip">
      {drums.map((drum, row) => {
        const y = 2 + row * ROW_H;
        return (
          <g key={drum} data-row={drum}>
            <text x={LABEL_W - 4} y={y + ROW_H - 4} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.6)" fontFamily="monospace">
              {DRUM_LABEL[drum] ?? drum}
            </text>
            {Array.from({ length: pattern.steps }, (_, step) => {
              const beatLine = step % pattern.stepsPerBeat === 0;
              const event = pattern.events.find((e) => e.drum === drum && e.step === step);
              const fill = event ? (shade?.(event.index) ?? (event.accent ? 'rgb(251,191,36)' : 'rgb(52,211,153)')) : 'none';
              return (
                <rect
                  key={step}
                  data-step={step}
                  data-hit={event ? 'yes' : 'no'}
                  data-sound={event ? DRUM_SOUND[drum] : undefined}
                  x={LABEL_W + step * cellW + 0.5}
                  y={y + 1}
                  width={Math.max(1, cellW - 1)}
                  height={ROW_H - 2}
                  rx={2}
                  fill={fill}
                  stroke={beatLine ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)'}
                  strokeWidth={beatLine ? 1 : 0.5}
                />
              );
            })}
          </g>
        );
      })}
      {cursorX !== null && <line data-testid="pattern-cursor" x1={cursorX} x2={cursorX} y1={0} y2={height} stroke="rgb(244,63,94)" strokeWidth={2} />}
    </svg>
  );
}
