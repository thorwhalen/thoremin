# Thoremin User Guide

The player guide now ships WITH the app: short pages with pictures for every instrument, every tool and every settings section, starting with what to do and keeping the details folded away.

- **Read it:** https://apps.thorwhalen.com/thoremin/guide/ (or Tools, then Guide, in the app; each instrument's editor links to its own page).
- **Its sources** are Markdown in [`guide/`](../guide/), built to `public/guide/` by `npm run guide`; the pictures are captured from the app by `npm run guide:media`. A test (`test/guide_coverage.test.ts`) fails when an instrument, tool or editor section has no entry.
- **How to change it:** the `thoremin-dev-guide` skill ([`skills/thoremin-dev-guide/SKILL.md`](../skills/thoremin-dev-guide/SKILL.md)).
- **Every node and knob:** the generated manual, [`docs/CATALOG.md`](CATALOG.md) (served at `/thoremin/manual.html`).

This file used to hold the whole user guide (2026-10); its content is in the guide's pages, and the old text is in git history.

## The legacy app (frozen)

`?engine=legacy` opens the original hand-theremin: a Settings drawer with **Synth** and **Plugins** tabs, and an **AI DJ** plugin that steers Google **Lyria RealTime** generative music with weighted text "strains" (you supply a Gemini API key, stored only in your browser). It is kept reachable so that work is not lost, but it is **frozen**: no new features, and it is excluded from refactors. The gesture-steered generative layer of the main app is the **Generative** section of the instrument editor.
