/**
 * The conductor slice's extension id (#600 S18b), import-free: the manifest declares it, and the
 * branch names its overlay element's ports by it (`overlayPortName`). Not `conductor` (its node,
 * branch and dial key, which core and three extensions name by contract), so the architecture
 * ratchet counts only what really names the slice.
 */
export const CONDUCTOR_EXTENSION_ID = 'conductor-tool';
