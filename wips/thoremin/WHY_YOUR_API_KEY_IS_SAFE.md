# Why Your API Key Is Safe

## How Thoremin Stores Your Key

When you enter your Gemini API key in the AI DJ plugin, it is stored in your browser's **`localStorage`** — a storage mechanism built into every modern web browser that is:

- **Local to your device** — the data never leaves your browser automatically
- **Scoped to this website** — other websites cannot read it
- **Persistent** — it survives page reloads and browser restarts (until you clear it)

The key is stored under the key `thoremin:plugin:ai-dj:apiKey`.

## Thoremin Has No Backend

Thoremin is a **100% client-side application**. There is no server, no database, no analytics, and no telemetry. The entire application runs in your browser as static JavaScript files.

Your API key is transmitted **only** to Google's Generative AI API servers (`generativelanguage.googleapis.com`) when the AI DJ plugin makes Lyria Realtime API calls. This is the same endpoint you'd connect to if you used the API directly from your own code.

## How to Verify This Yourself

### 1. Check Local Storage

Open your browser's DevTools (F12 or Cmd+Option+I) → **Application** tab → **Local Storage** → select this site. You'll see your key stored there. No other storage mechanisms are used.

### 2. Monitor Network Activity

Open DevTools → **Network** tab → use the AI DJ plugin. You will see:

- **WebSocket connections** to `wss://generativelanguage.googleapis.com/...` — this is the Lyria Realtime API
- **No other outgoing connections** — no data is sent to any other server

### 3. Read the Source Code

The AI DJ plugin source code is open. The relevant files are:

- `src/plugins/ai-dj/ApiKeyDialog.tsx` — where the key is saved to localStorage
- `src/plugins/ai-dj/LyriaSession.ts` — where the key is used to connect to Google's API
- `src/plugins/ai-dj/definition.ts` — the plugin's activation flow

You can verify that the key is only ever passed to `new GoogleGenAI({ apiKey })` and nowhere else.

## Removing Your Key

To remove your API key at any time:

1. **From the app**: Toggle the AI DJ plugin off in Settings → Plugins, then clear your browser's local storage for this site
2. **From DevTools**: Application → Local Storage → right-click and delete the `thoremin:plugin:ai-dj:apiKey` entry
3. **From Google**: You can also revoke the key itself at [Google AI Studio](https://aistudio.google.com/apikey)
