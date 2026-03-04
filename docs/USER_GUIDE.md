# Thoremin User Guide

Thoremin is a browser-based polyphonic synthesizer controlled by hand gestures via your webcam.

## Getting Started

1. Open the app in a modern browser (Chrome recommended)
2. Allow camera access when prompted
3. Wait for the hand tracking model to load ("Loading Neural Engine")
4. Click **Initialize Audio Engine** (required for audio to work — browsers require a user gesture)
5. Hold your hand in front of the camera

## Core Controls

- **Left/Right movement** — controls pitch (frequency)
- **Up/Down movement** — controls volume (higher = louder)
- **Two hands** — play polyphonically, one note per hand

The system tracks your **index finger tip**.

## Synth Settings

Open the **Settings** panel (sliders icon, top right) → **Synth** tab:

| Setting | Description |
|---------|-------------|
| Root Note | Starting note of the scale (C through B) |
| Scale Type | Major, Pentatonic, or Minor Harmonic |
| Range (Octaves) | 1–3 octaves |
| Base Octave | Starting octave (1–5) |
| Instrument | Waveform: Sine, Square, Sawtooth, Triangle |
| Pitch Magnetism | 0% = free pitch glide, 100% = hard snap to scale notes |

Each hand can have independent settings, or use **Sync with Right** to mirror them.

## Plugins

Open **Settings** → **Plugins** tab to see available plugins and toggle them on/off.

### AI DJ Plugin

AI DJ uses Google's **Lyria Realtime** model to generate AI music that you can steer in real time alongside the theremin.

#### Setup

1. Toggle AI DJ on in Settings → Plugins
2. You'll be asked for a **Gemini API Key** (free at [Google AI Studio](https://aistudio.google.com/apikey))
3. The key is validated, stored in your browser's localStorage only, and never sent anywhere except Google's API

#### Vibes

A **Vibe** is a named collection of **strains** (text prompts with weights). Examples:
- "Chill Ambient" with strains: "Ambient Pads" (1.0), "Lo-Fi Hip Hop" (0.6)
- "Funky Groove" with strains: "Funk" (1.0), "Slap Bass" (0.8)

Use the **Edit** button to create, rename, delete vibes and manage their strains.

#### Controls

The AI DJ panel (bottom-right corner) includes:

- **Volume slider** — controls AI DJ output level relative to the theremin
- **Vibe selector** — choose which vibe to play
- **Strain sliders** — adjust weight of each strain in real time (0 = off, 2 = maximum)
- **Play/Pause/Stop** — transport controls
- **Timer** — sessions max out at 10 minutes, then you restart
- **Settings** (gear icon) — generation parameters:
  - BPM (60–200), Scale/Key, Density, Brightness, Guidance, Temperature, Top K
  - Mute Bass, Mute Drums, Bass+Drums Only
  - Generation Mode: Quality / Diversity / Vocalization

The panel can be minimized to a single bar while you play the theremin.

#### Tips

- Changes to strains/settings take ~2 seconds to be audible (streaming latency)
- Changing BPM or Scale resets the music context — allow ~5 seconds to settle
- You can type any text as a strain prompt: genre names, instrument descriptions, moods, textures
- Prompts that violate safety guidelines are automatically filtered
