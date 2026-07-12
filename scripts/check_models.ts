/**
 * Verify every model id the assistant offers is still alive — by CALLING it.
 *
 * This exists because a provider's own catalogue is not a liveness signal. On
 * 2026-07-09 `gemini-2.5-flash` began returning `404 … no longer available` while
 * Google's models page still listed it as Stable, its deprecation page still promised an
 * October shutdown, and `ListModels` still returned it. The assistant's model choice is
 * persisted in the user's browser, so a silently-retired model means an error on every
 * send, forever, for anyone who had picked it.
 *
 * The only ground truth is a real request. This script sends the smallest possible one to
 * each pinned id in `src/plugins/assistant/providers.ts` and fails if any is gone.
 *
 *   npm run check:models
 *
 * Keys come from the environment (`GEMINI_API_KEY` / `GOOGLE_API_KEY`, `OPENAI_API_KEY`,
 * `ANTHROPIC_API_KEY`); a provider with no key is SKIPPED, not failed, so this is usable
 * with whatever subset of keys you happen to have. It is deliberately NOT wired into
 * `npm test` — it costs money (a few tokens) and needs network + secrets.
 *
 * Exit code is non-zero if any offered model is dead, so it can be run on a schedule.
 */
import { PROVIDERS, type ProviderSpec } from '../src/plugins/assistant/providers';
import type { ProviderId } from '../src/plugins/assistant/types';

/**
 * A model is "alive" if the API will talk to us about it at all. A 429 (quota/rate limit)
 * proves the model resolves — only a hard not-found means retired.
 *
 * `unknown` is the third, load-bearing state: the request never got far enough to say
 * anything about the model (a rejected key, a network failure). Collapsing that into
 * `dead` would turn an expired key into "all your models were retired" — a false alarm
 * that trains you to ignore the alarm. Collapsing it into `alive` would be a false green.
 * It is its own state, counted separately, and it never satisfies the "something was
 * actually verified" bar in {@link main}.
 */
type ProbeState = 'alive' | 'dead' | 'unknown';

interface Probe {
  state: ProbeState;
  status: number;
  detail: string;
}

const env = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
};

const API_KEY: Record<ProviderId, string | undefined> = {
  google: env('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'),
  openai: env('OPENAI_API_KEY'),
  anthropic: env('ANTHROPIC_API_KEY'),
};

/** The smallest real request each provider accepts, per provider's wire format. */
const REQUEST: Record<ProviderId, (modelId: string, key: string) => [string, RequestInit]> = {
  google: (modelId, key) => [
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    },
  ],
  openai: (modelId, key) => [
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: modelId, input: 'hi', max_output_tokens: 16 }),
    },
  ],
  anthropic: (modelId, key) => [
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: modelId, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    },
  ],
};

async function probe(id: ProviderId, modelId: string, key: string): Promise<Probe> {
  const [url, init] = REQUEST[id](modelId, key);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // Offline / DNS / TLS: says nothing about the model.
    return { state: 'unknown', status: 0, detail: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (res.ok) return { state: 'alive', status: res.status, detail: 'ok' };

  const body = await res.text();
  let message = body.slice(0, 140);
  try {
    message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message;
  } catch {
    /* non-JSON error body — keep the raw prefix */
  }
  const detail = message.replace(/\s+/g, ' ').trim();

  // 429 = rate limited or out of quota: the request was authorized and the model resolved,
  // so it exists.
  if (res.status === 429) return { state: 'alive', status: res.status, detail: 'rate-limited (model exists)' };
  // 401/403 = the KEY was rejected (expired, revoked, wrong project, missing scope). The
  // request died at the door and never reached model resolution, so this is no evidence
  // whatsoever about the model. Reporting it as DEAD would send you off deleting live
  // models from providers.ts because a key rotated.
  if (res.status === 401 || res.status === 403) {
    return { state: 'unknown', status: res.status, detail: `key rejected — cannot determine: ${detail}` };
  }
  // Anything else non-2xx that names the model (404, or a 400 "model not found") is a
  // retirement.
  return { state: 'dead', status: res.status, detail };
}

/** Per-run counts. `alive + dead` is what was actually *determined*; `unknown` is not. */
interface Tally {
  alive: number;
  dead: number;
  unknown: number;
}

const EMPTY: Tally = { alive: 0, dead: 0, unknown: 0 };
const add = (a: Tally, b: Tally): Tally => ({
  alive: a.alive + b.alive,
  dead: a.dead + b.dead,
  unknown: a.unknown + b.unknown,
});

const MARK: Record<ProbeState, string> = { alive: 'ok  ', dead: 'DEAD', unknown: '????' };

async function checkProvider(spec: ProviderSpec): Promise<Tally> {
  const key = API_KEY[spec.id];
  if (!key) {
    // No key: nothing was asked, so nothing is known. This contributes ZERO to every
    // bucket — including `unknown` — and so cannot prop up the "did we verify anything?"
    // check in main().
    console.log(`\n${spec.label}\n  (skipped — no API key in the environment)`);
    return EMPTY;
  }
  console.log(`\n${spec.label}`);
  const results = await Promise.all(
    spec.models.map(async (m) => ({ model: m, probe: await probe(spec.id, m.id, key) })),
  );
  for (const { model, probe: p } of results) {
    const star = model.recommended ? ' *' : '  ';
    const detail = p.state === 'alive' ? p.detail : `${p.status} — ${p.detail}`;
    console.log(`  ${MARK[p.state]}${star} ${model.id.padEnd(24)} ${detail}`);
  }
  const count = (s: ProbeState): number => results.filter((r) => r.probe.state === s).length;
  return { alive: count('alive'), dead: count('dead'), unknown: count('unknown') };
}

async function main(): Promise<void> {
  console.log('Probing every model the assistant offers (a catalogue listing is not a liveness signal).');
  let t = EMPTY;
  for (const spec of Object.values(PROVIDERS)) t = add(t, await checkProvider(spec));

  const determined = t.alive + t.dead;
  console.log(`\n${determined} model(s) verified, ${t.dead} dead, ${t.unknown} indeterminate.`);

  if (t.dead > 0) {
    console.error(`\n${t.dead} offered model(s) are no longer available. Update src/plugins/assistant/providers.ts.`);
    process.exitCode = 1;
    return;
  }

  // The false-green guard. A run that probed NOTHING — every provider skipped for want of
  // a key, or every key rejected — used to print no failures and exit 0, which on a
  // schedule (where a lapsed secret is exactly the thing that goes wrong quietly) reads as
  // "all models are fine" while having checked precisely zero models. "I could not tell"
  // is not "it is fine": fail, and say why.
  if (determined === 0) {
    console.error(
      'FAILED: not a single model was actually verified — this run proves nothing.\n' +
        'Every provider was skipped (no key) or refused the key it was given. Set at least one of\n' +
        'GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY to a valid key and re-run.',
    );
    process.exitCode = 1;
    return;
  }

  if (t.unknown > 0) {
    console.warn(
      `WARNING: ${t.unknown} model(s) could not be checked (rejected key or network). They are NOT\n` +
        'confirmed alive — only the models marked ok above were verified.',
    );
  }
  console.log('All models that could be checked are alive. (* = recommended)');
}

void main();
