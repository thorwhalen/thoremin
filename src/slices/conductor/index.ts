/**
 * The conductor slice (#187; a slice since #600 S18b): conducting a score or a recording with the
 * hands, the body or a dancer, the sampled orchestra that can play the score, and the loaded score
 * itself. Listed in `extensions.json` like any extension, so the core-alone build proves the shell no
 * longer names it.
 *
 * Its node ids, ports, branch id and dial paths (`conductor`, `conductor.*`) are a contract the song
 * slice, the air extension's chord chart and the faces extension's pose transport read by name, and
 * stay as they were. The `conductor` dial is one object (its version 2 is core's v20-to-v21 store
 * step, moved here); `conductorPrefs` is a device pref with the lead offsets as a store-controls
 * port; the loaded score is a transient (`scoreDoc`) the `score` node and the chord chart read.
 *
 * It hushes the instrument's own voices while it conducts (the score is the music: `hushes`), makes
 * its one-hand branch read both hands for the split with the hands alone (`readsTwoHands`), and
 * composes the body source while it reads the body (`toolDerive`, so an explicit branch set that
 * lists the conductor gets it too).
 *
 * Kept in core on purpose: the `score` node and its contract (a common-word node type; renaming it
 * would change every graph golden), the overlay's conductor readout and its ports (persisted
 * overlay settings; S19's file).
 */
import { defineExtension, dialSlice, transientPort } from '@thoremin/sdk/instruments/extension';
import type { NodeDef } from '@thoremin/dag';
import type { ScoreDoc } from '@thoremin/sdk/score/schema';
import { conductorNode } from './nodes/conductor';
import { orchestraNode } from './nodes/orchestra';
import { conductorReadsTwoHands } from './nodes/conductor.schema';
import { conductor } from './branches';
import { CONDUCTOR_STORES } from './stores';
import { CONDUCTOR_EXTENSION_ID } from './id';
import { CONDUCTOR_HUD_ELEMENT, conductorHudElement } from './nodes/overlay/conductor_hud';
import { ConductorPrefsSchema, ConductorSettingsSchema, DEFAULT_CONDUCTOR, DEFAULT_CONDUCTOR_PREFS, migrateConductorV1, migrateConductorV2, type ConductorPrefs, type ConductorSettings } from './schema';

export const CONDUCTOR_BRANCH_ID = 'conductor';
/** The feature groups the body conductor reads (#375): the pose stream, by what measures it. */
const BODY_CONDUCTOR_NEEDS = ['body.pos'] as const;

const on = (x: { enabled?: boolean } | undefined): boolean => x?.enabled === true;

/** Whether the conductor reads the body (#375): its source is `body` or `dancer`, or the body shapes
 *  its expression (#378, `expression: body` while a hand beats). */
export function conductorReadsBody(c: Partial<ConductorSettings> | undefined): boolean {
  const source = c?.source;
  return source === 'body' || source === 'dancer' || c?.expression === 'body';
}

/** Conducting, or its orchestra on: the branch is composed (the conductor idles until Start), so the
 *  soundfont and the pose model load before the first beat. */
const conducting = (c: Partial<ConductorSettings> | undefined): boolean => on(c) || on(c?.orchestra);

const dialOf = (s: Readonly<Record<string, unknown>>) => s.conductor as Partial<ConductorSettings> | undefined;

export const CONDUCTOR_EXTENSION = defineExtension({
  id: CONDUCTOR_EXTENSION_ID,
  nodes: [conductorNode, orchestraNode] as unknown as NodeDef<unknown>[],
  branches: [conductor],
  // Its beat ring on the video (#600 S18c; core's `conductorHud` before): beneath the markers, as core
  // drew it, and now above the air extension's pads and grid (contributed elements before the same
  // core element keep the extension list's order); configured by its own dial (`conductor.hudOnVideo`).
  overlay: [
    {
      name: CONDUCTOR_HUD_ELEMENT,
      category: 'output',
      drawBefore: 'markers',
      inputs: [
        { name: 'time', kind: 'musical-time' },
        { name: 'enabled', kind: 'boolean' },
      ],
      config: { dialKey: 'conductor' },
    },
  ],
  overlayElements: [conductorHudElement],
  dials: [
    dialSlice({
      key: 'conductor',
      schema: ConductorSettingsSchema.default(DEFAULT_CONDUCTOR),
      kind: 'conductor-config',
      meta: { facets: ['Conductor'], title: 'Conductor', description: 'Conduct the score with your hand: on/off, which hand and point to follow, how tightly the score follows the beat' },
      version: 3,
      migrations: { 1: migrateConductorV1, 2: migrateConductorV2 },
    }),
  ] as const,
  prefs: [
    {
      key: 'conductorPrefs',
      schema: ConductorPrefsSchema.default(DEFAULT_CONDUCTOR_PREFS),
      // The body conductor's lead offsets per joint (#427) -> the conductor's `leadOffsets` input.
      ports: [{ name: 'conductorLeadOffsets', kind: 'lead-offsets', read: (p: ConductorPrefs) => p.leadOffsets }],
    },
  ],
  transient: [transientPort<ScoreDoc>()('scoreDoc', 'score-doc')] as const,
  stores: Object.values(CONDUCTOR_STORES),
  hushes: [{ id: 'conducting', reason: 'while conducting', while: (s) => on(dialOf(s)) }],
  readsTwoHands: (s) => conductorReadsTwoHands(dialOf(s)),
  derive: (s) => (conducting(dialOf(s)) ? [CONDUCTOR_BRANCH_ID] : []),
  // The body conductor reads the pose stream: the body source comes with him, also into an explicit
  // set that lists the conductor (only while it is on, not for a saved set naming an idle one).
  toolDerive: (s, { composed, implying }) => (composed.includes(CONDUCTOR_BRANCH_ID) && conducting(dialOf(s)) && conductorReadsBody(dialOf(s)) ? implying(BODY_CONDUCTOR_NEEDS) : []),
});

export default CONDUCTOR_EXTENSION;
