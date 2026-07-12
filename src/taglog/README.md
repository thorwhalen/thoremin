# taglog

A live event-tagging tool: toggle a small set of **tags** on/off while recording,
and each toggle appends a `(t, tag, status)` row to an event-log JSONL — thoremin
writes it as `<take>.annotations.jsonl` — that later **segments** the recorded
streams (video / audio / features) for analysis or ML training.

(Vocabulary: the nouns in this folder are deliberately generic — `tag`, `TagDef`,
`TagEvent` — because it is built to lift out. thoremin's product surface calls the
feature **annotations**; see `src/app/tagging/TaggingControls.tsx` for the mapping.)

This folder is written to **lift out of thoremin into a standalone package**
(working name `taglog`). It has no thoremin imports and no React; the thoremin-
specific glue lives outside it (`src/app/tagging/*`, the overlay element in
`src/nodes/output/canvas_overlay.ts`) and imports *from* here, never the reverse.

Design research + prior art (BORIS, Praat, ELAN, OTIO, Allen's interval algebra) and
references are in thoremin **issue #92** and **discussion #81**.

## The three layers (strict dependency direction)

```
presentation  ->  affordances  <-  provider
   (host)          (pure core)      (storage)
```

That one rule — everything depends on the affordance core, the core depends on
nothing — is what makes extraction mechanical.

### `affordances/` — the pure heart (Zod schemas + logic; no React/storage/timers)

| File | What |
|------|------|
| `schema.ts` | `TagDef` (kind lives here), `TagEvent` (status lives here), `TaggingConfig`, `AnchorRecord`, and the neutral in-memory types (`TagAction`, `EdgeEvent`, `TagState`, `ResolvedInterval`). |
| `toggle.ts` | `applyToggle` / `closeAll` — the state machine: interval open↔close, point emit, BORIS-style mutual-exclusivity auto-close, `seq` ordering. |
| `leadIn.ts` | Lead-in / pre-roll correction: open shifts later, close earlier (shrink to the clean middle), degeneracy guard. |
| `resolve.ts` | `resolveIntervals` — pair edges into intervals/points for a segmentation consumer. |
| `codec.ts` | The pluggable `EventCodec` (representation strategy): `statusEnum` (default), `pointPair`, `kindField`. |

### `adapters/` — pure exporters (`ResolvedInterval[] -> string`)

Audacity labels · WebVTT · CSV · Praat TextGrid · OTIO. Add a format by adding one
entry to `ADAPTERS`.

### `provider/` — persistence + the event sink

- `defsStore.ts` — persist named **tag sets** (last-used pre-seed) via a zodal
  `DataProvider<T>` (localStorage default via `@zodal/store-localstorage`). Swap the
  provider to retarget storage; call sites never change.
- `sink.ts` — `TagEventSink`: buffer the anchor + codec-serialized rows, `drain()`
  to JSONL (mirrors thoremin's `FeatureJsonlTap`).

## Time alignment (the highest-stakes part, design §5)

One recording anchor `t0`; event times stamped from the recorder's **absolute engine
clock** (`performance.now()/1000` = the DAG `ctx.time`) — the SAME clock
`features.jsonl` uses, so both streams share one frame by construction and the take
offset is a uniform `t - t0` for every stream (the manifest SSOT rule). A
self-describing **anchor record** (`t` = the origin t0) as the file's first line; an
optional **segmentation-time offset** never baked into stored `t`; and a **burned-in
corner overlay** as the in-band ground truth. File-creation dates are rejected as a clock.

## Quick use

```ts
import { emptyTagState, applyToggle, closeAll, resolveIntervals, TagEventSink } from 'taglog';

let state = emptyTagState();
const sink = new TagEventSink('statusEnum');
sink.writeAnchor({ anchor: true, t: t0, clock: 'media', /* … */ });   // t = origin (== manifest.t0)

// on each click / keypress (t = absolute engine seconds = performance.now()/1000):
const { state: next, edges } = applyToggle(state, defs, { tagId: 'pluck', t, src: 'key' }, config);
state = next;
sink.append(edges);

// on stop:
sink.append(closeAll(state, defs, tEnd, config, 'auto').edges);
const jsonl = sink.drain();                          // -> {stem}.annotations.jsonl
const intervals = resolveIntervals(/* parsed edges */, { endT: tEnd });
```
