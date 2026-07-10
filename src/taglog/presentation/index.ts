/**
 * taglog presentation layer — subscriber-only render helpers (design §9.3).
 *
 * Pure "what to draw" computation the host UI subscribes to. It imports the
 * affordance/adapter types but nothing imports it back — so the same core can drive
 * a different UI or headless capture. Today it ships the burned-in corner overlay's
 * frame computation; the React button stack / countdown live in the host.
 */
export * from './overlay';
