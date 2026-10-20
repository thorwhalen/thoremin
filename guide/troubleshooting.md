---
title: Troubleshooting
---

## No sound

Browsers will not make sound until you tap. Press **Tap to play** once. If the status still says it is waiting, check that the tab is not muted and the device volume is up. The **m** key mutes everything the instrument plays: press it again.

## The camera does not start

- Allow the camera when the browser asks. If you said no, the address bar's camera icon lets you change it.
- Close other programs that use the camera (video calls). Only one can have it.
- The page must be opened from its real address (`https://`), not from a file.
- Without a camera, add `?slot.source=synthetic-hands` to the address to try the instruments with a pretend hand.

## It does not see my hand, or jitters

- Light the room from the front or the side, not from behind you. The face tools say "Too dark: add light, or record again in this light" when it is too dim.
- Keep your hand in view and a little away from the camera, with the palm toward it.
- The **Wrist Theremin** instrument is steadier than the fingertip.
- With two hands close together the second can be missed; move them apart.

## Browsers

Chrome and Edge work best. Safari and Firefox work for playing, with gaps: no folder picker for saving takes (they download a zip), and Safari has no Web MIDI. The first time you open the sign-language reader it downloads a little.

## MIDI

Needs Chrome or Edge. Switch **MIDI** on in the editor, then choose the port. A device you plug in later appears after you switch MIDI off and on. [Play Along (MIDI)](instrument:Play Along (MIDI)) needs a MIDI keyboard connected before you open it.

## Microphone

[Play Along (microphone)](instrument:Play Along (microphone)) asks to use the microphone. Allow it; if you said no, the address bar's icon lets you change it. It hears a guitar, a piano or a recording through the speakers; it hears chords best when the sound is clear.

## Latency (the sound comes late)

- Use headphones or a wired speaker: Bluetooth adds a noticeable delay.
- Close other heavy tabs. The hand model is the most expensive part.
- The air instruments predict the hit before the frame that shows it, so they sound on time even at 30 frames a second; a bright, steady picture helps them most.
- Add `?probe=latency` to the address to see where the time goes, stage by stage.

## Something broke

Reloading restores your saved instruments and your working state. If a setting seems wrong, reselecting the instrument reverts it to its saved version.
