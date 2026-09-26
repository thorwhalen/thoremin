/**
 * The `?probe=latency` switch (#227), kept apart from the probe itself so the host can
 * ask "is it requested?" without loading the probe: the installer is imported lazily,
 * only when the answer is yes, and costs the main bundle nothing otherwise.
 */
export const LATENCY_PROBE_PARAM = 'probe';
export const LATENCY_PROBE_VALUE = 'latency';

/** Does this URL query ask for the latency probe? */
export function latencyProbeRequested(search: string = typeof location !== 'undefined' ? location.search : ''): boolean {
  return new URLSearchParams(search).get(LATENCY_PROBE_PARAM) === LATENCY_PROBE_VALUE;
}
