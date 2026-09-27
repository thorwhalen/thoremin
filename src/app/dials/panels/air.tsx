/**
 * The air instruments' UI, per id (#249) — the React half of `library/category.ts`.
 *
 * `AIR_INSTRUMENTS` (React-free, so the library's pure modules and Node tests can read
 * it) says WHICH air instruments exist and how to tell one is on. This map says what
 * each looks like in the Instruments view: the settings section the editor shows (first
 * and open when the instrument being edited is that air instrument) and the live readout
 * shown under the chosen row. The `satisfies Record<AirInstrumentId, …>` is the guard:
 * add an air instrument to the category list and this file fails to typecheck until it
 * has a home here, so the Instruments view never needs to name one.
 */
import type { ComponentType } from 'react';
import type { AirInstrumentId } from '@/app/library/category';
import { AirDrumControls, AirDrumReadout } from './airDrum';
import { AirBassControls, AirBassReadout } from './airBass';
import { AirGuitarControls, AirGuitarReadout } from './airGuitar';
import { AirFluteControls, AirFluteReadout } from './airFlute';

export interface AirInstrumentUi {
  /** The editor section's title (also its `data-section` hook). */
  section: string;
  /** The section's controls, including its own readout if it has one. */
  Controls: ComponentType;
  /** What it is doing right now, for the chosen row in the list. */
  Readout: ComponentType;
}

export const AIR_UI = {
  drum: { section: 'Air drum', Controls: AirDrumControls, Readout: AirDrumReadout },
  bass: { section: 'Air bass', Controls: AirBassControls, Readout: AirBassReadout },
  guitar: { section: 'Air guitar', Controls: AirGuitarControls, Readout: AirGuitarReadout },
  flute: { section: 'Air flute', Controls: AirFluteControls, Readout: AirFluteReadout },
} as const satisfies Record<AirInstrumentId, AirInstrumentUi>;
