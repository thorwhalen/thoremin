/**
 * The Feature Lab slice's React half (#600 S16b): the Lab tool (its panel, its icon, running detached
 * while the meters draw, with the bar's stop control), the mount effect that keeps the Lab's feature
 * demand in step with its config, and the status hook that tells the panel whether the face model is
 * loading for its face meters.
 */
import { FlaskConical } from 'lucide-react';
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import LabPanel from './panels/LabPanel';
import { installLabDemand } from './app/labDemand';
import { FACE_SOURCE_NODE, makeLabFaceReporter, setLab, useLab, useLabFace } from './app/state';
import { LAB_EXTENSION_ID } from './index';

export const LAB_TOOL_ID = 'lab';

export const LAB_UI: ExtensionUi = {
  id: LAB_EXTENSION_ID,
  panels: [],
  statusHooks: [
    {
      nodeId: FACE_SOURCE_NODE,
      make: (engine) => makeLabFaceReporter(engine),
      onRemoved: () => useLabFace.getState().report('absent'),
      reset: () => useLabFace.getState().report('absent'),
    },
  ],
  // While the meters are shown the Lab claims the groups it shows (S16a): what composes their
  // sources and gates the vector nodes.
  onMount: [() => installLabDemand()],
  tools: [
    {
      id: LAB_TOOL_ID,
      label: 'Feature Lab',
      description: 'Measure the raw face and hand features the instrument plays from — live, normalized meters.',
      group: 'tool',
      defaultPinned: false,
      Panel: LabPanel,
      icon: FlaskConical,
      // The meters keep drawing over the video with the panel closed: the bar marks the Lab
      // running and turns the meters off (#136's way back out).
      detached: { useRunning: () => useLab().show, stop: () => setLab({ show: false }), hint: 'turn the meters off' },
    },
  ],
};

export default LAB_UI;
