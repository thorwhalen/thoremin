# Thoremin Architecture Notes

For AI agents and developers working on this codebase.

## Tech Stack

- **React 19** + **TypeScript 5.8** + **Vite 6**
- **Tailwind CSS v4** (with `@theme` syntax, not tailwind.config)
- **Framer Motion** via `motion/react` for animations
- **TensorFlow.js** + **MediaPipe Hands** for hand tracking (runs in browser via WebGL)
- **Web Audio API** for oscillator synthesis
- **@google/genai** SDK for Lyria Realtime music generation (WebSocket-based)
- No backend — 100% client-side static app

## Directory Structure

```
src/
  main.tsx              # Entry point
  App.tsx               # Root: wraps Theremin with PluginProvider
  index.css             # Tailwind imports + custom theme (Inter, JetBrains Mono)
  constants.ts          # Shared: NOTES, SCALE_TYPES, INSTRUMENTS, HandSettings, generateScale

  components/
    Theremin.tsx         # Core: camera, hand tracking, canvas, header/footer
    HandSettingsForm.tsx # Synth settings form for one hand
    SettingsPanel.tsx    # Slide-in settings drawer with Synth/Plugins tabs
    InfoModal.tsx        # How-to-play overlay
    PluginListPanel.tsx  # Plugin toggle switches (rendered in Settings → Plugins tab)

  hooks/
    useAudioEngine.ts   # Core oscillator synth (polyphonic, 2 voices, magnetic pitch)
    useLocalStorage.ts   # Generic localStorage<->state hook

  plugins/
    types.ts            # PluginDefinition, PluginInstance, PluginContext, SetupDialogProps
    registry.ts         # Static array of all plugin definitions
    PluginProvider.tsx   # React context: lifecycle, settings, setup dialogs, overlay rendering

    ai-dj/
      types.ts          # Strain, Vibe, AiDjSettings, PlaybackState, defaults
      definition.ts     # Plugin definition (id, name, icon, activate, SetupDialog)
      ApiKeyDialog.tsx   # API key entry + validation modal
      LyriaSession.ts   # WebSocket session manager (connect, play, pause, stop, prompts, config)
      audioUtils.ts     # Base64 PCM → AudioBuffer decoding
      AiDjOverlayPanel.tsx  # Main panel: volume, vibes, strains, settings, transport
      AiDjSettingsPanel.tsx # (Retained for potential future use; content now in overlay)
      VibeEditor.tsx    # CRUD modal for managing vibes
```

## Plugin System

### Contract

A plugin implements `PluginDefinition<TSettings>`:
- `id`, `name`, `description`, `icon` — metadata
- `defaultSettings` — persisted to `localStorage` at `thoremin:plugin:{id}:settings`
- `SetupDialog?` — React component shown before first activation (e.g., API key entry)
- `activate(ctx)` → `PluginInstance` — async; receives AudioContext, masterGain, settings access

A `PluginInstance` provides:
- `deactivate()` — cleanup (close WebSockets, disconnect audio nodes)
- `OverlayPanel?` — React component rendered floating on the main screen
- `SettingsPanel?` — React component rendered inside the Plugins settings tab

### Lifecycle

1. User toggles plugin on in Settings → Plugins
2. If `SetupDialog` exists and prerequisites not met → show dialog
3. On dialog success (or if no dialog needed) → call `activate(ctx)`
4. Plugin status: `disabled` → `activating` → `active` (or `error`)
5. Toggle off → `deactivate()` → `disabled`

### Shared Audio

`PluginProvider` owns the `AudioContext` and `masterGain` refs. Both the core synth (`useAudioEngine`) and plugins connect to the same audio graph:

```
[Oscillator voices] → masterGain → destination
[Lyria audio chunks] → plugin outputNode → masterGain → destination
```

### Adding a New Plugin

1. Create `src/plugins/{name}/` directory
2. Define types and `defaultSettings`
3. Implement `PluginDefinition` in `definition.ts`
4. Add to `pluginRegistry` array in `src/plugins/registry.ts`

### Storage Keys

| Key | Content |
|-----|---------|
| `thoremin:plugins:enabled` | `string[]` of enabled plugin IDs |
| `thoremin:plugin:{id}:settings` | Plugin settings JSON |
| `thoremin:plugin:ai-dj:apiKey` | Gemini API key (string) |
| `thoremin:plugin:ai-dj:vibes` | Vibe[] JSON |
| `thoremin:plugin:ai-dj:activeVibe` | Active vibe ID (string) |

## Key Implementation Details

### Hand Tracking

- MediaPipe Hands with `full` model via CDN
- Detection runs in `requestAnimationFrame` loop
- Handedness is inverted due to mirrored camera feed
- Index finger tip keypoint → normalized (x, y) coordinates

### Audio Engine

- `getMagneticFrequency()` maps x position to frequency with configurable snap-to-scale
- Smooth frequency ramps (30ms time constant) and volume ramps (100ms)
- Inactive voices cleaned up every 1 second

### Lyria Realtime Integration

- Model: `lyria-realtime-exp` via `v1alpha` API version
- WebSocket connection: `ai.live.music.connect()`
- Audio: 48kHz stereo PCM streamed in ~2s chunks, scheduled ahead via Web Audio
- 2-second playback buffer to handle jitter
- `setWeightedPrompts` throttled to 200ms
- `applyConfig` sends `setMusicGenerationConfig`; calls `resetContext()` when BPM or Scale changes
- Sessions max out at 10 minutes
