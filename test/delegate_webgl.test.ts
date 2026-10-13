/**
 * `webglRenderer` (`src/nodes/sources/delegate.ts`, #391 item 4): the probe that decides
 * the models' delegate creates a throwaway WebGL context. Whatever happens while reading
 * the renderer string, it must give that context back (browsers cap live contexts, and the
 * MediaPipe GPU delegate needs one), and a failure reads as "unknown" (null), never cached.
 *
 * Each test imports a fresh copy of the module: the renderer string is cached per page.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

/** A fake canvas whose context's `getParameter` returns `renderer`, or throws. */
function fakeDocument(options: { renderer?: string; throws?: boolean; debugInfo?: boolean }) {
  const loseContext = vi.fn();
  const gl = {
    RENDERER: 0x1f01,
    getExtension(name: string) {
      if (name === 'WEBGL_debug_renderer_info') return options.debugInfo === false ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 };
      if (name === 'WEBGL_lose_context') return { loseContext };
      return null;
    },
    getParameter: vi.fn(() => {
      if (options.throws) throw new Error('context lost');
      return options.renderer;
    }),
  };
  const canvas = { getContext: (kind: string) => (kind === 'webgl2' ? gl : null) };
  return { document: { createElement: () => canvas }, gl, loseContext };
}

async function freshDelegate() {
  vi.resetModules();
  return import('@/nodes/sources/delegate');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('webglRenderer', () => {
  it('reads the unmasked renderer, loses the throwaway context, and caches the string', async () => {
    const fake = fakeDocument({ renderer: 'ANGLE (SwiftShader)' });
    vi.stubGlobal('document', fake.document);
    const { webglRenderer, resolveDelegate } = await freshDelegate();
    expect(webglRenderer()).toBe('ANGLE (SwiftShader)');
    expect(fake.gl.getParameter).toHaveBeenCalledWith(0x9246);
    expect(fake.loseContext).toHaveBeenCalledTimes(1);
    expect(webglRenderer()).toBe('ANGLE (SwiftShader)');
    expect(fake.gl.getParameter).toHaveBeenCalledTimes(1); // cached
    expect(resolveDelegate('auto')).toBe('CPU');
  });

  it('falls back to the masked RENDERER without the debug extension', async () => {
    const fake = fakeDocument({ renderer: 'WebKit WebGL', debugInfo: false });
    vi.stubGlobal('document', fake.document);
    const { webglRenderer } = await freshDelegate();
    expect(webglRenderer()).toBe('WebKit WebGL');
    expect(fake.gl.getParameter).toHaveBeenCalledWith(0x1f01);
  });

  it('is null without a document or a WebGL context', async () => {
    const { webglRenderer } = await freshDelegate();
    expect(webglRenderer()).toBeNull();
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(webglRenderer()).toBeNull();
  });

  it('when getParameter throws: null, and not cached (a later probe may succeed)', async () => {
    const fake = fakeDocument({ throws: true });
    vi.stubGlobal('document', fake.document);
    const { webglRenderer } = await freshDelegate();
    expect(webglRenderer()).toBeNull();
    const ok = fakeDocument({ renderer: 'Apple M1 Max' });
    vi.stubGlobal('document', ok.document);
    expect(webglRenderer()).toBe('Apple M1 Max');
  });

  it('when getParameter throws, the throwaway context is still lost (#391 item 4)', async () => {
    const fake = fakeDocument({ throws: true });
    vi.stubGlobal('document', fake.document);
    const { webglRenderer } = await freshDelegate();
    expect(webglRenderer()).toBeNull();
    expect(fake.loseContext).toHaveBeenCalledTimes(1);
  });
});
