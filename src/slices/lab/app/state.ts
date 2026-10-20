/**
 * The Lab's state as its panel reads and writes it (#600 S16b): its per-device pref through the
 * SDK's controls seam, and the face model's load phase, which the slice's own status hook mirrors
 * from the face source node (core's face status was what the panel read before).
 */
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { controls } from '@thoremin/sdk-ui/host';
import type { OutputReader } from '@thoremin/sdk-ui/types';
import { defaultFeatureLab, FeatureLabSchema, LAB_PREF, type FeatureLabConfig } from '../schema';

/** The Lab's config now (the pref, or its default before the store has one). */
export function labConfig(): FeatureLabConfig {
  return (controls().get()[LAB_PREF] as FeatureLabConfig | undefined) ?? defaultFeatureLab();
}

/** Patch the Lab's config (`setLab({ show: true })`); an invalid result is ignored. */
export function setLab(patch: Partial<FeatureLabConfig>): void {
  const r = FeatureLabSchema.safeParse({ ...labConfig(), ...patch });
  if (r.success) controls().setPref(LAB_PREF, r.data);
}

/** A React hook over the Lab's config. */
export function useLab(): FeatureLabConfig {
  return useSyncExternalStore((l) => controls().subscribe(l), labConfig, labConfig);
}

/** The face source node, whose `status` says whether the face model is loading. */
export const FACE_SOURCE_NODE = 'camFace';

type FacePhase = 'absent' | 'loading' | 'ready' | 'error' | 'other';

/** The face model's phase, as the panel's note needs it. */
export const useLabFace = create<{ phase: FacePhase; report(phase: FacePhase): void }>((set) => ({
  phase: 'absent',
  report: (phase) => set((s) => (s.phase === phase ? s : { phase })),
}));

/** The status hook's per-tick sink: the face node's phase, on a change only. */
export function makeLabFaceReporter(engine: OutputReader): () => void {
  return () => {
    const s = engine.getOutput(FACE_SOURCE_NODE, 'status') as { phase?: string } | undefined;
    const phase: FacePhase = !s ? 'absent' : s.phase === 'loading' || s.phase === 'ready' || s.phase === 'error' ? s.phase : 'other';
    useLabFace.getState().report(phase);
  };
}
