/**
 * The device's measured input stage, as the app imports it. The store itself is the SDK's app half
 * (`@thoremin/sdk-ui/audio/inputStage`, #881), so a slice and a standalone game page (`play/`) read
 * and write the same per-device record the app does; this module re-exports it, and adds the React
 * hook the app's panels would read it through.
 */
import { useStore } from 'zustand';
import { inputStageStore, type InputStageState } from '@thoremin/sdk-ui/audio/inputStage';

export {
  INPUT_STAGE_RECORD_ID,
  INPUT_STAGE_STORAGE_KEY,
  createInputStageStore,
  hydrateInputStage,
  inputStageRecord,
  inputStageRecordNow,
  inputStageStore,
  parseInputStageRecord,
  setInputStage,
  storedInputStage,
  type InputStageRecord,
  type InputStageState,
  type InputStageStoreOptions,
} from '@thoremin/sdk-ui/audio/inputStage';
export { createInputStageProvider } from '@thoremin/sdk-ui/audio/inputStageProvider';

/** The stored stage in a React component (re-renders when it changes). */
export function useInputStage<T>(selector: (s: InputStageState) => T): T {
  return useStore(inputStageStore(), selector);
}
