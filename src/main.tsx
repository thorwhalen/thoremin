/**
 * App entry — selects which front-end to mount.
 *
 * By default mounts the DAG-driven instrument view (`./app/App`) — the typed
 * dataflow engine everything new is built on, and now the default at the bare
 * URL. Append `?engine=legacy` (alias `?engine=classic`) to mount the original
 * hand-theremin app (`./App`, including the Lyria AI-DJ plugin). `?engine=dag`
 * is still honored and equals the default, so existing links keep working.
 * Only the non-default (legacy) view is code-split, so it never weighs on the
 * default path.
 *
 * `?source=video&video=<url>` runs the DAG view camera-free from a pre-recorded
 * clip (Stream Applier M-A); see {@link parseSourceSpec}.
 */
import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import DagApp from './app/App.tsx';
import {parseSourceSpec} from './app/sourceSpec';
import './index.css';

const engineParam = new URLSearchParams(window.location.search).get('engine');
const useLegacyEngine = engineParam === 'legacy' || engineParam === 'classic';
const source = parseSourceSpec(window.location.search);

const LegacyApp = lazy(() => import('./App.tsx'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {useLegacyEngine ? (
      <Suspense fallback={null}>
        <LegacyApp />
      </Suspense>
    ) : (
      <DagApp source={source} />
    )}
  </StrictMode>,
);
