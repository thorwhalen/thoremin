# Apps: one site, several entries, a landing that opens nothing

Status: accepted 2026-10-29 (decided by an independent agent review of the options; the owner asked for "an independent app that uses the tools", no camera on arrival, and the listening app findable from the landing page).

## The problem

The listening games (Sing Along, Play Along Lessons, Match the Note), the Audio timing take and the Sound mapper were added into the camera app: as an extension slice (`audio-games`) and a tool (`sound-mapper`). So a visitor who wanted to sing had to arrive at a page that loaded MediaPipe and asked for the camera, and then find the games inside the camera app's instrument list. The bare URL *was* the camera app.

## The decision

One repository and one deploy unit (no tw_platform change), several Vite entries:

| Path | Entry | What it is | Asks for |
|---|---|---|---|
| `/thoremin/` | `index.html` | The landing: a static page, no module script, one card per app with a picture and a line. | nothing |
| `/thoremin/instruments/` | `instruments/index.html` -> `src/main.tsx` | The camera app, unchanged in behaviour. | the camera, on arrival (the visitor chose it) |
| `/thoremin/play/` | `play/index.html` and `play/<page>.html` | The listening app: the standalone game pages (#889), no React, no graph, no camera. Also built alone and deployed as **funfon** at `/funfon/`. | the microphone, when a game starts |
| `/thoremin/guide/`, `/thoremin/manual.html` | `public/` | Unchanged. | nothing |

The camera app's path is `instruments/` because the app's own vocabulary already calls its things instruments (the Instruments view, the guide's Instruments page); `app/` says nothing and `camera/` names the sensor, not the thing.

**Old links keep working.** Every old link to the bare URL that meant the camera app carried a query or a hash (`?slot.source=synthetic-hands`, `?engine=legacy`, `?replay=...`, `?source=video&video=...`, `?hands=...`, `?probe=latency`, `?carve.source=...`, `?synthetic.hands=...`, `?audio.source=...`). The landing's one inline script forwards ANY arrival with a query or a hash to `instruments/` with both intact (`location.replace`, before anything is drawn): one rule, no list to keep. A bare arrival stays on the landing. localStorage is per origin, so every saved instrument, map and preference survives the move.

**The camera app's relative addresses do not move.** Its page sets `<base href="../">`, so every relative address it builds (the guide and manual links, `?replay=` fixtures, anything fetched relative to the page) resolves under `/thoremin/` exactly as before the move. The app uses no relative `history` URL and no `href="#..."`, which a base would redirect. Built assets are base-absolute and unaffected.

**The guide** links "Back to the app" to `../instruments/`, and its footer and home page name the landing for the listening games. A guide link written `[text](app:<path>)` stays relative to the site base (`app:instruments/`, `app:play/`).

## Where the Sound mapper lives

Done: `play/sound-mapper.html` over `packages/sound-mapper/`, its own budget in `scripts/check_play_bundle.ts` (`PAGE_EXTRAS`), linked from the landing and the funfon home. Its map keeps the localStorage key it had in the camera app, so a player's taught sounds carry over (same origin).


A page of the listening app, `play/sound-mapper.html`, plain DOM like the other pages (the store is vanilla zustand; `getState` / `subscribe` need no React). Its schema, model and store move into a package (`packages/sound-mapper/`, Zod only in its schema, as `@thoremin/games` does). It carries a Zod collection the games do not, so it gets its own allow-list entries and budget line in `scripts/check_play_bundle.ts`. The React tool inside the camera app is removed rather than kept for a transition: one home per thing.

## What the camera app no longer ships

Done: `extensions.json` lists neither; `extensions.lab.json` (the camera list plus `audio-games`) is what `npm run test:lab` builds with, a CI step. The camera app's Tools launcher has a *Listening games* link (`play/`), and the three seeds, the Listening games editor section and the listen area left the player guide. A returning player's persisted `games` dial and `gamesPrefs` are no longer part of the camera app's state (the goldens in `test/fixtures/persisted/__golden__/` were regenerated for that); the standalone pages keep their own timing offset (`funfon.playerOffset`).


`audio-games` and `sound-mapper` leave `extensions.json`, so the camera build no longer lists the listening class, the three game seeds, the Audio timing take or the tool; the camera app's Tools launcher links to the listening app instead. The games slice stays in the tree as the seam for a game that uses the camera and the microphone together, listed by a second manifest the test run builds with, so its tests keep running; if no such game exists by the time the apps are split into repositories, it is deleted.

## Load only what is needed

- The landing has no script file: `test/apps_landing.test.ts` holds it to that (no module script, no `getUserMedia`, no MediaPipe), and `smoke/tests/landing.smoke.ts` checks in a browser that it requests no script and calls no `getUserMedia`.
- The listening pages are held by `scripts/check_play_bundle.ts` (an allow-list of modules and a byte budget per page) and by `smoke/tests/play_pages.smoke.ts` (no app chunk, no model, no wasm requested).
- The camera app does not load the games once `audio-games` leaves its manifest.

## Later: separate repositories

The product may be renamed and split into public and private parts. The split this layout makes cheap: funfon already builds from `play/` alone; its remaining ties (`src/audio/browser.ts`, `@thoremin/sdk/audio`, `@thoremin/sdk-ui/audio`, `@thoremin/judge`, `@thoremin/games`, the sound mapper package) are workspace packages, so the split is "publish or vendor those, move `play/`". The camera app keeps `src/`, `instruments/` and the rest. The landing is one static file owned by whichever repository serves `/thoremin/`; its only contract is the forwarding rule, which no split touches. Each app's entry imports only from the shared packages and its own folder, and the bundle checks above keep it so.
