# @thoremin/sources

Media sources behind one interface: search, resolve a pasted link or a chosen file, and open an item as a playback session, with the rights each item carries checked on the one path every item takes.

```ts
import { createSourceRegistry, defaultAdapters } from '@thoremin/sources';

const sources = createSourceRegistry(defaultAdapters());
const { hits, failures } = await sources.search('bach');      // Internet Archive and Audius, keyless
const item = await sources.resolveHit(hits[0]);                // an item, with its other tracks in `parts`
const linked = await sources.resolveInput('https://archive.org/details/The_Open_Goldberg_Variations-11823');
const session = await sources.open(item, host);                // host.openOwned plays the bytes
session.play();
```

## The three seams

- **`SourceAdapter`**: one module per provider, registered as data (`id`, `label`, `rights`, `capabilities`, `matches?`, `search?`, `resolve`, `open`). The registry refuses an adapter whose declared capabilities disagree with the functions it has, and an unknown source id raises (never a fallback).
- **`Rights`**: `embed_only`, `pcm_local`, `pcm_redistributable`, `symbolic`. `RIGHTS_PROFILES` says which uses (`decode`, `analyse`, `cache`) each allows; `allows(rights, use)` is the check every consumer makes. An item may narrow its adapter's rights, never widen them; owned audio is decoded only through `fetchOwnedBytes`, which checks the item's rights first.
- **`PlaybackSession`**: `play`, `pause`, `seek?`, `setRate?`, `setVolume?`, `position()`, `playing()`, `on(state | ended | buffering)`, `close()`, and `capabilities`: what the transport can do, with its pause lead, seek granularity and position lag as figures with a source (`measured` or `stated`).

## Adapters (v1)

| id | Search | Links | Rights | Notes |
|---|---|---|---|---|
| `file` | no | a chosen file | `pcm_local` | decoded on the device, never uploaded |
| `internet-archive` | keyless | `archive.org/details/...`, `/download/...` | `pcm_local` | items that state a licence by default; an item's tracks in `parts` |
| `audius` | keyless | `audius.co/<artist>/<track>` | `pcm_local` | gated or unstreamable tracks are left out |
| `url` | no | any `http(s)` address | `pcm_local` | the host must allow other pages to read it (CORS) |

Every adapter takes an injected `fetch`, so its tests run on recorded responses (`test/fixtures/sources/`).
