/**
 * The body slice's React half (#600 S17b): its editor section (body tracking on/off, the pose model,
 * the body-to-sound routes) and its mount effect (the routes claim the feature groups they read, so
 * the body vector computes them with the Lab closed; it was started by the app shell), and the
 * browser's pose model loader, which it installs as the `webcam-body` node's default.
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { BodyControls } from './panels/body';
import { startBodyRouteDemand } from './app/bodyRouteDemand';
import { loadBodyLandmarker } from './app/body_landmarker';
import { provideBodyLandmarkerFactory } from './nodes/webcam_body';

// The browser's body model loader, installed when this half loads (before any engine starts):
// the node's pure side never names MediaPipe, and tasks-vision loads only when the body is on.
provideBodyLandmarkerFactory(loadBodyLandmarker);

export const BODY_UI: ExtensionUi = {
  id: 'body-tracking',
  panels: [{ instrumentId: 'body', section: 'Body', Controls: BodyControls, Readout: () => null, readoutOn: () => false }],
  statusHooks: [],
  onMount: [() => startBodyRouteDemand()],
};

export default BODY_UI;
