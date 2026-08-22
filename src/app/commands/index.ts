/**
 * Command-dispatch layer (#87) — the param-mutation command surface of thoremin,
 * built on `acture`. Public entry point: the {@link registry} singleton and the
 * command definitions. See `dials.ts` for the hard command/hot-path boundary and
 * `test/commands_firewall.test.ts` for the import firewall that enforces it.
 */
export { registry, createThoreminRegistry, approvals, history, journal } from './registry';
export { DIAL_COMMANDS, setDialCmd, setDialInCmd, resetDialCmd, patchDialsCmd, applyDialSet, applyDialSetIn } from './dials';
export {
  DIAL_LEAVES,
  structuredDialLeaves,
  structuredLeafPaths,
  leafByPath,
  resolveDialPath,
  setIn,
  type DialLeaf,
  type LeafKind,
} from './paths';
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
export {
  installMiddleware,
  composeMiddleware,
  type Dispatch,
  type Middleware,
} from './middleware';
export {
  createJournal,
  replayJournal,
  type Journal,
  type JournalEntry,
  type JournalExport,
  type ReplayReport,
} from './journal';
export {
  createDialsHistory,
  layersEqual,
  type DialsHistory,
  type HistoryEntry,
  type LayerStoreLike,
} from './history';
