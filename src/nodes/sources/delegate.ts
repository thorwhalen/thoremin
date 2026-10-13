/**
 * Which MediaPipe delegate the camera models run on (step 4 of the 2026-10-05 timing
 * plan, #240): chosen by what the browser's WebGL actually is, not assumed.
 *
 * Why. The GPU delegate is MediaPipe's WebGL path. On a real GPU it is the fast one
 * (21 ms per hand frame against 42 on the CPU delegate, M1 Max). On a SOFTWARE WebGL
 * renderer (SwiftShader, llvmpipe: a machine or VM without a usable GPU, a GPU on
 * Chromium's blocklist, a headless browser) "GPU" is the CPU emulating a GPU, and it is
 * the slow one by a wide margin: measured in headless Chromium 153 on SwiftShader, 693 ms
 * a frame on the GPU delegate against 109 ms on the CPU delegate (WebAssembly + SIMD).
 * The old rule ("try GPU, fall back to CPU when it throws") never fell back there,
 * because SwiftShader does not throw: it is just seven times slower.
 *
 * So the models' `delegate` param gains `auto`, the default: the CPU delegate when the
 * renderer is known to be a software one, the GPU delegate otherwise, with the old
 * throw-and-fall-back kept behind it (so a browser without WebGL still lands on the CPU). `GPU` and `CPU` still force one.
 * A masked renderer string (privacy modes) reads as hardware: today's behaviour.
 */
import { z } from 'zod';

export const DelegateChoiceSchema = z.enum(['auto', 'GPU', 'CPU']);
export type DelegateChoice = z.infer<typeof DelegateChoiceSchema>;
export type Delegate = 'GPU' | 'CPU';

/** Renderer strings of WebGL implemented in software. */
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software ?(rasterizer|renderer)|microsoft basic render/i;

/** Whether a WebGL renderer string names a software implementation. */
export function isSoftwareRenderer(renderer: string): boolean {
  return SOFTWARE_RENDERER.test(renderer);
}

let cachedRenderer: string | undefined;

/**
 * This browser's WebGL renderer string (unmasked where the browser allows), or null when
 * no WebGL context could be made. A string is cached (the probe creates a throwaway
 * context); a failure is not, since it may be transient (too many contexts, a GPU
 * process restarting).
 */
export function webglRenderer(): string | null {
  if (cachedRenderer !== undefined) return cachedRenderer;
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const r = gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    cachedRenderer = typeof r === 'string' ? r : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return cachedRenderer;
  } catch {
    return null;
  }
}

/**
 * The delegate to load with. `auto`: CPU when the renderer is KNOWN to be software, the
 * GPU otherwise (no WebGL context, or none yet, keeps the GPU first and its
 * throw-and-fall-back, exactly as before). `GPU` / `CPU` force one without probing.
 * `renderer` is injectable for tests; it defaults to {@link webglRenderer}.
 */
export function resolveDelegate(choice: DelegateChoice, renderer?: string | null): Delegate {
  if (choice !== 'auto') return choice;
  const r = renderer !== undefined ? renderer : webglRenderer();
  return r !== null && isSoftwareRenderer(r) ? 'CPU' : 'GPU';
}
