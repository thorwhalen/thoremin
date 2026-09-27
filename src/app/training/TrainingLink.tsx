/**
 * "Train this instrument" (#263, #269): the one link at the top of an instrument's
 * editor that goes to its training, wherever that lives.
 *
 * The route comes from the instrument spec (`trainingRouteFor`): a declared
 * `training.route`, else the air branch it composes, else the Trainer tool. A section
 * route opens and scrolls to the trainer inside the editor (which is rendered whenever
 * this link is, so the scroll always has a target); a tool route opens the tool. The
 * shipping rule's answer: a feature nobody can find is not shipped, and this is how a
 * player finds the training from the instrument they are looking at.
 */
import type { InstrumentSpec } from '@/instruments/spec';
import { useTools } from '../toolsStore';
import { goToTraining, trainingRouteFor } from './routes';

export function TrainingLink({ spec }: { spec: InstrumentSpec | undefined }) {
  const route = trainingRouteFor(spec);
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-left text-xs text-emerald-200 transition hover:bg-emerald-400/20"
      data-testid="training-link"
      data-route={route.id}
      title={route.hint}
      onClick={() => goToTraining(route, { openTool: (id) => useTools.getState().openTool(id) })}
    >
      <span className="font-semibold">Train: {route.label}</span>
      <span className="text-[10px] text-emerald-200/60">{route.tool ? 'opens a tool' : 'in this instrument'}</span>
    </button>
  );
}
