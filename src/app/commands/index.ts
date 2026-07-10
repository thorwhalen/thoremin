/**
 * Command-dispatch layer (#87) — the param-mutation command surface of thoremin,
 * built on `acture`. Public entry point: the {@link registry} singleton and the
 * command definitions. See `dials.ts` for the hard command/hot-path boundary and
 * `test/commands_firewall.test.ts` for the import firewall that enforces it.
 */
export { registry, createThoreminRegistry, approvals } from './registry';
export { DIAL_COMMANDS, setDialCmd, resetDialCmd, patchDialsCmd, applyDialSet } from './dials';
export { DIAL_FIELD_COMMANDS, generateDialCommands, setCommandIdFor } from './perDial';
export { INSTRUMENT_COMMANDS, loadInstrumentCmd, saveInstrumentCmd, createInstrumentCmd } from './instruments';
export {
  installConfirmationGate,
  createApprovalStore,
  confirmationGate,
  defaultGetRisk,
  type ApprovalStore,
  type RiskMeta,
  type SideEffect,
  type AssistantDispatchContext,
} from './confirmation';
