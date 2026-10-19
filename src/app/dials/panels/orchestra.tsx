/**
 * The orchestra controls (#187 PR 5), inside the conductor section (so the settings
 * editor and the Conductor tool panel show the same ones): switch the sampled orchestra
 * on, see it load, and set its overall and per-section levels. Every control writes a
 * leaf of the structured `conductor` dial (`conductor.orchestra.*`) through
 * `dispatchDialSetIn`, the single write path; the level sliders dispatch per notch (steps
 * of 0.05), the same trade the catch-up slider makes.
 *
 * The download is named before it happens (the lazy-loading rule: a multi-megabyte
 * download is labelled as such before the player triggers it): the toggle states the
 * soundfont's size. The readout is the shared `LoadStatusReadout`, fed by the engine
 * loop's reporter (`orchestraStatus.ts`).
 */
import { dispatchDialSetIn } from '../../dispatchDial';
import { useDialsSettings } from '../useDialsSettings';
import { LoadStatusReadout } from '@thoremin/sdk-ui/loadStatus';
import { useOrchestraStatus } from '../../orchestraStatus';
import { DEFAULT_ORCHESTRA, SOUNDFONT_SIZE_MB, type OrchestraSettings } from '@/nodes/output/orchestra.schema';
import { SECTIONS, type Section } from '@/nodes/output/orchestra_map.schema';
import type { ConductorSettings } from '@/settings/schema';

const SECTION_LABEL: Record<Section, string> = {
  strings: 'Strings',
  woodwinds: 'Woodwinds',
  brass: 'Brass',
  percussion: 'Timpani & percussion',
  other: 'Other',
};

function Level({ label, path, value, testId }: { key?: string; label: string; path: string; value: number; testId: string }) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span>
        {label} <span className="text-white/40">({Math.round(value * 100)}%)</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        data-testid={testId}
        onChange={(e) => dispatchDialSetIn(path, Number(e.target.value))}
      />
    </label>
  );
}

export function OrchestraControls() {
  const { state } = useDialsSettings();
  const c = (state.effective.conductor ?? {}) as Partial<ConductorSettings>;
  const o: OrchestraSettings = { ...DEFAULT_ORCHESTRA, ...(c.orchestra ?? {}) };
  const sections = { ...DEFAULT_ORCHESTRA.sections, ...(o.sections ?? {}) };
  const status = useOrchestraStatus((s) => s.status);

  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-2" data-testid="orchestra-controls">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={o.enabled}
          aria-label="Play with the orchestra"
          onChange={(e) => dispatchDialSetIn('conductor.orchestra.enabled', e.target.checked)}
        />
        <span>
          Play with the orchestra <span className="text-white/40">(sampled instruments, a {SOUNDFONT_SIZE_MB} MB download the first time)</span>
        </span>
      </label>
      <LoadStatusReadout status={status} enabled={o.enabled} offMessage="Off: the piece plays on the instrument's own synth" />
      {o.enabled && (
        <div className="space-y-1.5">
          <Level label="Orchestra volume" path="conductor.orchestra.volume" value={o.volume} testId="orchestra-volume" />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={o.pizzicato}
              aria-label="Strings pizzicato on a sharp stroke"
              data-testid="orchestra-pizzicato"
              onChange={(e) => dispatchDialSetIn('conductor.orchestra.pizzicato', e.target.checked)}
            />
            <span>
              Strings pizzicato on a sharp stroke <span className="text-white/40">(back to the bow on a smooth one)</span>
            </span>
          </label>
          {SECTIONS.map((s) => (
            <Level key={s} label={SECTION_LABEL[s]} path={`conductor.orchestra.sections.${s}`} value={sections[s]} testId={`orchestra-section-${s}`} />
          ))}
        </div>
      )}
    </div>
  );
}
