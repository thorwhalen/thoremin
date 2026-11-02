/**
 * JSONP, for the one keyless catalogue that answers scripts but not `fetch` (Deezer sends no CORS
 * header). A script tag with a one-time callback, removed when it answers or times out.
 */
export type Jsonp = (url: string, opts?: { callbackParam?: string; timeoutMs?: number; signal?: AbortSignal }) => Promise<unknown>;

let n = 0;

export const browserJsonp: Jsonp = (url, opts = {}) =>
  new Promise((resolve, reject) => {
    const name = `__thoreminJsonp${++n}`;
    const w = window as unknown as Record<string, unknown>;
    const el = document.createElement('script');
    const done = () => {
      clearTimeout(timer);
      delete w[name];
      el.remove();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('no answer'));
    }, opts.timeoutMs ?? 10_000);
    opts.signal?.addEventListener('abort', () => {
      done();
      reject(new DOMException('aborted', 'AbortError'));
    });
    w[name] = (body: unknown) => {
      done();
      resolve(body);
    };
    const u = new URL(url);
    u.searchParams.set(opts.callbackParam ?? 'callback', name);
    el.src = u.href;
    el.onerror = () => {
      done();
      reject(new Error('unreachable'));
    };
    document.head.appendChild(el);
  });
