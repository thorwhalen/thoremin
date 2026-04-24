import { Scale, MusicGenerationMode } from '@google/genai';
import { usePluginManager } from '../PluginProvider';
import { AiDjSettings } from './types';

const SCALE_OPTIONS: { value: Scale; label: string }[] = [
  { value: Scale.SCALE_UNSPECIFIED, label: 'Auto (model decides)' },
  { value: Scale.C_MAJOR_A_MINOR, label: 'C major / A minor' },
  { value: Scale.D_FLAT_MAJOR_B_FLAT_MINOR, label: 'Db major / Bb minor' },
  { value: Scale.D_MAJOR_B_MINOR, label: 'D major / B minor' },
  { value: Scale.E_FLAT_MAJOR_C_MINOR, label: 'Eb major / C minor' },
  { value: Scale.E_MAJOR_D_FLAT_MINOR, label: 'E major / C# minor' },
  { value: Scale.F_MAJOR_D_MINOR, label: 'F major / D minor' },
  { value: Scale.G_FLAT_MAJOR_E_FLAT_MINOR, label: 'Gb major / Eb minor' },
  { value: Scale.G_MAJOR_E_MINOR, label: 'G major / E minor' },
  { value: Scale.A_FLAT_MAJOR_F_MINOR, label: 'Ab major / F minor' },
  { value: Scale.A_MAJOR_G_FLAT_MINOR, label: 'A major / F# minor' },
  { value: Scale.B_FLAT_MAJOR_G_MINOR, label: 'Bb major / G minor' },
  { value: Scale.B_MAJOR_A_FLAT_MINOR, label: 'B major / Ab minor' },
];

function NumericInput({ value, onChange, min, max, step = 1, label }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest text-white/40">{label}</label>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(min, value - step))}
          className="w-7 h-7 bg-white/5 border border-white/10 rounded text-xs hover:bg-white/10 transition-colors"
        >-</button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
          className="flex-1 bg-white/5 border border-white/10 rounded p-1.5 text-xs text-center font-mono focus:outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          onClick={() => onChange(Math.min(max, value + step))}
          className="w-7 h-7 bg-white/5 border border-white/10 rounded text-xs hover:bg-white/10 transition-colors"
        >+</button>
      </div>
    </div>
  );
}

function Slider({ value, onChange, min, max, step, label, displayValue }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step: number; label: string; displayValue?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-[10px] uppercase tracking-widest text-white/40">
        <span>{label}</span>
        <span className="text-emerald-500">{displayValue ?? value.toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
      />
    </div>
  );
}

export function AiDjSettingsPanel() {
  const { getPluginSettings, updatePluginSettings } = usePluginManager();
  const settings = getPluginSettings<AiDjSettings>('ai-dj');

  const update = (patch: Partial<AiDjSettings>) => {
    updatePluginSettings('ai-dj', patch);
  };

  return (
    <div className="space-y-4">
      <p className="text-[10px] uppercase tracking-widest text-white/40">Generation Config</p>

      <div className="grid grid-cols-2 gap-3">
        <NumericInput label="BPM" value={settings.bpm} onChange={v => update({ bpm: v })} min={60} max={200} />
        <NumericInput label="Top K" value={settings.topK} onChange={v => update({ topK: v })} min={1} max={1000} step={10} />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-widest text-white/40">Scale</label>
        <select
          value={settings.scale}
          onChange={e => update({ scale: e.target.value as Scale })}
          className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-xs focus:outline-none focus:border-emerald-500"
        >
          {SCALE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <p className="text-[9px] text-white/20">Changing BPM or Scale resets the music context (~5s settling time).</p>

      <Slider label="Density" value={settings.density} onChange={v => update({ density: v })} min={0} max={1} step={0.05} />
      <Slider label="Brightness" value={settings.brightness} onChange={v => update({ brightness: v })} min={0} max={1} step={0.05} />
      <Slider label="Guidance" value={settings.guidance} onChange={v => update({ guidance: v })} min={0} max={6} step={0.1} displayValue={settings.guidance.toFixed(1)} />
      <Slider label="Temperature" value={settings.temperature} onChange={v => update({ temperature: v })} min={0} max={3} step={0.1} displayValue={settings.temperature.toFixed(1)} />

      <div className="space-y-2 pt-2">
        <p className="text-[10px] uppercase tracking-widest text-white/40">Instrument Muting</p>
        <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
          <input type="checkbox" checked={settings.muteBass} onChange={e => update({ muteBass: e.target.checked })} className="accent-emerald-500" />
          Mute Bass
        </label>
        <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
          <input type="checkbox" checked={settings.muteDrums} onChange={e => update({ muteDrums: e.target.checked })} className="accent-emerald-500" />
          Mute Drums
        </label>
        <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
          <input type="checkbox" checked={settings.onlyBassAndDrums} onChange={e => update({ onlyBassAndDrums: e.target.checked })} className="accent-emerald-500" />
          Only Bass & Drums
        </label>
      </div>

      <div className="space-y-2 pt-2">
        <p className="text-[10px] uppercase tracking-widest text-white/40">Generation Mode</p>
        {([
          { value: MusicGenerationMode.QUALITY, label: 'Quality', desc: 'Higher quality music' },
          { value: MusicGenerationMode.DIVERSITY, label: 'Diversity', desc: 'More diverse output' },
          { value: MusicGenerationMode.VOCALIZATION, label: 'Vocalization', desc: 'Vocal-like textures' },
        ] as const).map(mode => (
          <label key={mode.value} className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="radio"
              name="genMode"
              checked={settings.musicGenerationMode === mode.value}
              onChange={() => update({ musicGenerationMode: mode.value })}
              className="accent-emerald-500"
            />
            <span className="text-white/60">{mode.label}</span>
            <span className="text-white/20">— {mode.desc}</span>
          </label>
        ))}
      </div>

      <div className="pt-3 border-t border-white/5">
        <button
          onClick={() => {
            localStorage.removeItem('thoremin:plugin:ai-dj:apiKey');
            window.location.reload();
          }}
          className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors uppercase tracking-widest"
        >
          Remove API Key
        </button>
      </div>
    </div>
  );
}
