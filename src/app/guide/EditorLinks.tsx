/**
 * The links at the top of an instrument's editor: where its training is (#263, #269) and where the
 * player guide explains it. One component so the editor panel stays one line for both.
 */
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import type { InstrumentSpec } from '@/instruments/spec';
import { TrainingLink } from '../training/TrainingLink';
import { GuideLink } from './GuideLink';

/** The shipped instruments' names: the ones the guide has a page of their own for. */
const SHIPPED_NAMES: ReadonlySet<string> = new Set(SEED_INSTRUMENTS.map((s) => s.name));

export function EditorLinks({ name, spec, category }: { name: string; spec: InstrumentSpec | undefined; category: string | undefined }) {
  return (
    <div className="mb-2 space-y-2">
      <TrainingLink spec={spec} />
      <GuideLink name={name} classId={spec?.class ?? category} shipped={SHIPPED_NAMES} />
    </div>
  );
}
