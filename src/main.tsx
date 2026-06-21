/**
 * App entry — selects which front-end to mount.
 *
 * By default mounts the current production hand-theremin app (`./App`), exactly
 * as before: a static import that paints synchronously from the entry bundle —
 * the deployed default is untouched. Append `?engine=dag` to the URL to mount
 * the DAG-driven instrument view (`./app/App`) instead — an opt-in alternate
 * that runs the same gesture→audio path through the typed DAG engine. Only the
 * DAG view is code-split (lazy), so it never weighs on the default path.
 */
import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import DefaultApp from './App.tsx';
import './index.css';

const useDagEngine =
  new URLSearchParams(window.location.search).get('engine') === 'dag';

const DagApp = lazy(() => import('./app/App.tsx'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {useDagEngine ? (
      <Suspense fallback={null}>
        <DagApp />
      </Suspense>
    ) : (
      <DefaultApp />
    )}
  </StrictMode>,
);
