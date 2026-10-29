# @thoremin/sound-mapper

Teach it a few struck sounds (taps on a table, a pot), give each a drum, and every tap plays its drum a few milliseconds later. This package is the framework-free half: the schema of a sound map (`schema.ts`: the taught taps are raw audio, the SSOT; the classifier is derived in `model.ts`), and a vanilla zustand store (`store.ts`) that holds one lease on the audio-input hub while the mapper plays or is being taught, and saves the map through a zodal named collection (localStorage by default, key `thoremin.soundMapper.maps`).

```ts
import { createSoundMapperStore } from '@thoremin/sound-mapper/store';

const mapper = createSoundMapperStore({ hub: () => myHub });
await mapper.getState().hydrate();
const id = mapper.getState().addClass();
mapper.getState().teach(id); // tap it 6 to 10 times
mapper.getState().teach(null);
mapper.getState().play(true);
```

Everything that sounds runs on the audio thread, in the `sound-mapper` analyser of the shared audio-input worklet (`@thoremin/sdk/audio/mapper`); the store only configures it. The page is `play/sound-mapper.html` (the listening app); the design is `docs/design/audio-input.md` and `docs/design/apps.md`.
