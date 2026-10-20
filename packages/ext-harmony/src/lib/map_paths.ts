/**
 * The chord map's paths and words (#713, #714 PR B2): the idiom chosen on the dial followed as the
 * player plays (each new chord in force moves the cursor along it, or off it) and drawn ahead as a
 * ghost trail; the caption set's words on the moves. The idioms are degrees of a seven-chord key, so
 * a scale's own five chords get neither trail nor idiom status.
 *
 * Pure: the SDK's idiom and caption libraries over the map's chords.
 */
import { captionSet as captionSetOf, type CaptionSet, type CaptionSetId } from '@thoremin/sdk/harmony/captions';
import type { RatingsTable } from '@thoremin/sdk/harmony/ratings';
import { ahead, followCommit, idiomById, startFollow, type FollowCursor } from '@thoremin/sdk/harmony/idioms';
import { keyOf } from '@thoremin/sdk/harmony/chord';
import { keyName, type ScaleSpec } from '@thoremin/sdk/music/theory';
import { DEGREES, captionTextFor, type DiatonicChord, type MoveText } from './chord_map';

/** Where the player is on the idiom: its name, the step reached (1-based, 0 before the first) and
 *  whether the last chord kept to it. */
export interface IdiomStatus {
  name: string;
  step: number;
  steps: number;
  onPath: boolean;
}

export interface PathFrame {
  /** The dial's idiom id, `none` for no trail. */
  idiom: string;
  captionSet: CaptionSetId;
  trailSteps: number;
  /** The key in force (with the face's parallel): the idiom is realized in it. */
  spec: ScaleSpec;
  chords: readonly DiatonicChord[];
  /** The degree of the chord in force, -1 for none. */
  shown: number;
  /** The player's ratings, for their own caption set (#715). */
  ratings?: RatingsTable;
}

export interface PathView {
  trail?: { degrees: (number | null)[]; label: string };
  moveText?: MoveText;
  idiom: IdiomStatus | null;
}

export interface PathFollower {
  push(frame: PathFrame): PathView;
  reset(): void;
}

export function createPathFollower(): PathFollower {
  let captions: { id: CaptionSetId; ratings: RatingsTable | undefined; set: CaptionSet } | null = null;
  // Reset by another idiom or another key.
  let cursor: FollowCursor = startFollow();
  let cursorKey = '';
  let followed = -1;
  const reset = () => {
    cursor = startFollow();
    cursorKey = '';
    followed = -1;
  };
  return {
    push({ idiom: id, captionSet, trailSteps, spec, chords, shown, ratings }) {
      const key = keyOf(spec);
      // Rebuilt when the set changes, or (the player's own) when a new rating arrives.
      if (captions?.id !== captionSet || (captionSet === 'mine' && captions.ratings !== ratings)) captions = { id: captionSet, ratings, set: captionSetOf(captionSet, { ratings }) };
      const moveText = captionSet === 'interval' ? undefined : captionTextFor(captions.set, chords, key);
      const idiom = id !== 'none' && chords.length === DEGREES ? idiomById(id) : undefined;
      if (!idiom) {
        reset();
        return { moveText, idiom: null };
      }
      const cKey = `${idiom.id}|${keyName(spec)}|${spec.type}`;
      if (cKey !== cursorKey) {
        reset();
        cursorKey = cKey;
      }
      if (shown >= 0 && shown !== followed) cursor = followCommit(idiom, key, cursor, shown);
      followed = shown;
      return {
        moveText,
        trail: { degrees: ahead(idiom, key, cursor, trailSteps).map((s) => s.cell), label: idiom.name },
        idiom: { name: idiom.name, step: cursor.position + 1, steps: idiom.steps.length, onPath: cursor.onPath },
      };
    },
    reset,
  };
}
