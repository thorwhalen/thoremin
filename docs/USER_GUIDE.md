# Thoremin User Guide

Thoremin turns your webcam into a musical instrument: your hands play notes, your
face can add timbre or play chords, and everything you do can be recorded,
annotated and measured.

**Live:** https://apps.thorwhalen.com/thoremin/

> This guide covers the app you get at the bare URL. The original hand-theremin
> (with the Lyria AI-DJ plugin) is still reachable at `?engine=legacy`, but it is
> **frozen** — no new features land there. See [the legacy app](#the-legacy-app-frozen)
> at the bottom.

---

## 1. Playing

1. Open the app in a modern browser (Chrome recommended) and allow camera access.
2. Tap **anywhere** (or the play button) to start audio — browsers require a user
   gesture before any sound.
3. Hold a hand up in front of the camera.

| Gesture | Effect |
|---------|--------|
| Move left / right | Pitch — snapped toward the scale by the **magnetism** amount |
| Move up / down | Volume (higher = louder) |
| Two hands | Two independent voices (each with its own scale, sound and range) |
| Open / close the hand | Brightness (if enabled for the instrument) |
| Pinch | Vibrato (if enabled) |
| Close a fist | Mute that hand (if enabled) |

By default the **index fingertip** is the note position; an instrument can switch
that to the **wrist**, which is steadier and easier for beginners.

Beyond that, each finger can be routed to an effect (**brightness, vibrato, pan,
pitch-bend, octave, gate**) — continuously, or as a trigger.

### Camera-free

Add `?source=video&video=<url>` to run the instrument from a pre-recorded clip
instead of the camera. Useful for demos and for checking overlays without being on
camera yourself.

---

## 2. Instruments and the library

An **instrument** is a named saved profile — a complete snapshot of every setting
(scales, sounds, ranges, face mapping, finger routing, overlay). It is *not* a
timbre; a timbre is a **sound** (see the Sound section below).

Open the instruments panel to browse them:

- **Star** an instrument to favorite it; sort by star or name, filter by name.
- **Default** is now a per-instrument setting (not the star) — the default is what
  loads on a fresh session, and it is marked `(default)` in the list.
- **Tags** — add your own keywords. A tag is `{label, emoji}`; renaming a tag never
  breaks the instruments it is on. There is a tag manager for renaming, re-emoji-ing
  and deleting, and typing a comma-separated list autosuggests existing tags.
- **System tags** — read-only emoji chips derived automatically from an instrument's
  parametrization (scale quality, whether notes come from index or wrist, whether the
  face is doing expression / chords / pose, split voices, finger effects). You cannot
  edit or delete them; they can never go stale, because they are recomputed on read.
- **Hover** an instrument for a compact **summary**: the scale, both voices, the
  control sources, and only the non-default tweaks. More than the list row, less than
  opening the settings.

Loading an instrument makes it the clean baseline: editing marks it dirty,
re-selecting it reverts. **Save** overwrites; **Save as new** commits under a new
name. Your working state (including unsaved edits) survives a reload.

---

## 3. The dials panel

The gear button opens the settings panel. It is generated from the settings schema,
so it always matches what the instrument can actually do.

| Section | What is in it |
|---------|---------------|
| **Sound** | Per voice: root note, scale type (Major, Natural Minor, Major/Minor Pentatonic, Harmonic Minor, Blues, Chromatic), the **octave range** (a double-thumb slider, 1–3 octaves with a locked middle), the **sound** (timbre preset), volume. "Sync with right" mirrors the left voice. |
| **Hand** | Note position source (index / wrist), magnetism (0% = free glide, 100% = hard snap to scale notes), open-hand → brighter, pinch → vibrato, closed-fist mutes, position → stereo pan. |
| **Face** | The face mapping: **none**, **timbre** (smile → brightness, open mouth → vibrato), **chord** (facial expression → a diatonic triad), or **controls** (deliberate head / jaw / brow pose → a chord). Plus chord sound, volume, voicing (spread, bass-triad, close, shell, power) and rendering (sustained, strum, arp up/down/up-down, pulse, alberti), and per-expression sensitivity + which scale degree each expression plays. |
| **Finger effects** | Route each finger to an effect, with a sensitivity and a continuous/trigger mode. |
| **Overlay** | Toggle what is drawn on the video: the video itself, landmarks, control markers, pitch/scale guides, chord names, the keyboard strip, the face mesh, the index-finger guide, the HUD position. |
| **Feature Lab** | See section 7. |
| **Keyboard** | The shortcut reference. |

**Chords do not have to come from the melody scale.** Since #75 the chord source is
decoupled: it is auto-derived from your melody scale by default (so a pentatonic
melody still gets sensible seven-note chords), or you can set it explicitly.

---

## 4. Keyboard shortcuts and the command palette

| Key | Action |
|-----|--------|
| `↑` / `↓` | Octave up / down (clamped ±2) |
| `→` / `←` | Magnetism up / down |
| `m` | Toggle mute (silences the hands **and** the chords) |
| `1`–`9` | Toggle annotation 1–9 (only while annotation mode is on) |
| **`Cmd`/`Ctrl` + `K`** | **Command palette** |

Shortcuts never fire while you are typing in a text field.

The **command palette** is the fastest way to change anything: type a parameter
name and every dial is there as a searchable, typed command. An enum dial gives you
a dropdown; a bounded number gives you a small form with the real bounds. It works
while playing or while stopped.

---

## 5. The AI assistant

Open the assistant to chat with the instrument. It can actually *operate* it — it
dispatches the same commands the palette does, so "make the left hand a soft pad a
fifth below the right" is a thing it can just do.

- **Bring your own key.** Pick a provider (OpenAI / Anthropic / Google — the default
  is Gemini 3.5 Flash) and paste an API key. Everything runs **client-side**: your
  key stays in your browser and goes only to that provider.
- **Destructive actions ask first.** Loading, saving or creating an instrument can
  discard or overwrite work, so the assistant cannot do those on its own — you get an
  approve/deny card. Ordinary dial changes just happen (they are reversible: reload
  the instrument).

---

## 6. Recording and annotations

### Recording a take

The **Record** button opens a session sheet in the same slot — recording settings
live *outside* the instrument, because what you capture is a tooling preference, not
a musical one. Choose any subset of five streams:

| Stream | What it is |
|--------|-----------|
| **audio** | The master bus (what you hear) |
| **video + overlays** | What you *see* — the mirrored video with landmarks and guides |
| **pure webcam** | The raw camera, overlay-free |
| **overlay-only (alpha)** | Just the overlays on transparency (Chromium-only, experimental) |
| **features (JSONL)** | Every feature value, per tick — the machine-readable stream |

Then hit **Rec now**. You get a compact HUD with the elapsed time and which streams
are rolling; **Stop** writes the take.

A take is **one folder**, named after the take, containing every stream plus a
`manifest.json` that says where each stream starts on a shared clock — so the audio,
the video and the features line up without guessing. Thoremin will ask for a folder
if your browser supports it; otherwise you get the same folder as a single `.zip`.

### Annotating a take

Annotations let you mark *what was happening, when* — so a recording can be cut into
labelled segments afterwards (for analysis, or as ML training data).

- Set up your annotations in the annotation sheet: name them, choose **interval**
  (has a start and an end) or **point** (an instant), group mutually-exclusive ones
  so turning one on turns the others off, and give an annotation a **lead-in** if you
  want the first moments after you tap it trimmed away.
- While recording, tap an annotation (or press its digit, `1`–`9`) to toggle it. Open
  annotations blink, and a corner overlay burns the active ones into the video as
  in-band ground truth.
- Annotations are written to `<take>.annotations.jsonl` on the same clock as the
  features, so they segment every other stream by construction.

### Exporting annotations

The **Export** panel turns the last take's annotations into a file your tools can
open: **Audacity** label track, **WebVTT**, **CSV**, **Praat TextGrid**, or **OTIO**.
You choose whether the times are what you actually tapped (**raw**) or the lead-in
**corrected** ones.

---

## 7. The Feature Lab

The Feature Lab answers "what can I actually control?" — it is a measuring
instrument, not a sound.

Turn it on and you get a live grid of meters over the face and hand feature
catalog: ~200 scalar features (blendshapes, mesh geometry, head pose, symmetry,
action units, per-finger curls and gaps). Pick which **groups** to show.

- Every feature is **normalized online**, so a blendshape (0–1), a finger curl (in
  radians) and a head angle (in degrees) all read as comparable levels on the same
  grid. The bars adapt to *your* range as you move, and forget old extremes slowly.
- Each feature carries a **controllability** hint — `easy`, `moderate`, or
  `involuntary` — the honest answer to whether you could really drive it on purpose.
- **Derived features:** write your own formula over any features (e.g.
  `(browOuterUpLeft + browOuterUpRight) / 2`) and it becomes another meter. Formulas
  are validated as you type and run in a sandbox with no `eval` — the only things a
  formula can reach are feature values and a fixed set of math helpers.
- Save named **lab views** (which groups, which normalizer, which derived features)
  and load them back.

Feature values are captured by the recorder's feature stream, so anything you can
see in the lab you can also record and analyze offline.

---

## 8. MIDI out

Turn on MIDI output and thoremin drives an external instrument or DAW with the same
voices you hear — hands and chords both. It is off by default, and it is a no-op in
browsers without Web MIDI (Safari and iOS), so it never costs you anything until you
switch it on.

---

## 9. Under the hood (if you're curious)

Everything above is one **dataflow graph**: sensors → features → mapping → music
logic → synthesis → output, wired from small typed nodes. The full node catalog is
served by the app itself at
[`/thoremin/manual.html`](https://apps.thorwhalen.com/thoremin/manual.html) (the
**Manual** link in the header) and lives in the repo as
[`docs/CATALOG.md`](CATALOG.md).

---

## The legacy app (frozen)

`?engine=legacy` opens the original hand-theremin: a Settings drawer with **Synth**
and **Plugins** tabs, and an **AI DJ** plugin that steers Google **Lyria RealTime**
generative music with weighted text "strains" (you supply a Gemini API key, stored
only in your browser).

It is kept reachable so that work is not lost, but it is **frozen**: no new features,
and it is excluded from refactors. The legacy AI-DJ is retired there (#128); a
DAG-native, gesture-steered generative layer is tracked as a new feature (#141). Whether
that generative layer moves into the main
app or the legacy view is retired is tracked in issue #128.
