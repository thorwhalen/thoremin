# Changelog

## [0.2.0] - 2026-03-04

### Added

- **Plugin system** — extensible architecture for optional features
  - Plugin registry, lifecycle management, settings persistence via localStorage
  - Setup dialogs for plugins requiring configuration (e.g., API keys)
  - Two UI surfaces per plugin: overlay panel (floating) and settings panel (in drawer)
  - Shared AudioContext between core synth and plugins

- **AI DJ plugin** — real-time AI music generation via Google Lyria Realtime
  - Gemini API key management with validation and security info
  - **Vibes** — named collections of weighted text prompts (strains) for steering music
  - CRUD editor for vibes and strains
  - All Lyria generation parameters exposed: BPM, scale, density, brightness, guidance, temperature, top K, mute controls, generation mode
  - Volume control for AI DJ output level
  - Transport controls (play/pause/stop) with 10-minute session timer
  - Collapsible overlay panel for use alongside the theremin
  - 3 default vibes shipped: Chill Ambient, Funky Groove, Electronic

- **Settings tabs** — settings drawer now has Synth and Plugins tabs

- **Documentation** — user guide, architecture notes, changelog

### Changed

- **Refactored Theremin.tsx** from 515-line monolith into separate components:
  - `HandSettingsForm.tsx`, `SettingsPanel.tsx`, `InfoModal.tsx`
  - Shared constants moved to `constants.ts`
- **useAudioEngine** now accepts external AudioContext/masterGain refs for plugin sharing
- **App.tsx** wraps the app with `PluginProvider` context

### Technical

- `WHY_YOUR_API_KEY_IS_SAFE.md` documents API key storage security model
- AI DJ panel code-split into separate chunk via dynamic import
- Zero new runtime dependencies (uses existing `@google/genai` already in package.json)

## [0.1.0] - Initial

- Hand-tracking polyphonic theremin with oscillator synthesis
- Major, Pentatonic, Minor Harmonic scales
- Sine, Square, Sawtooth, Triangle waveforms
- Pitch magnetism (snap-to-scale)
- Independent left/right hand settings with sync option
