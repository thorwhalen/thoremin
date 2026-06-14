import { createRoot } from 'react-dom/client';
import App from './app/App';
import './index.css';

// Note: StrictMode is intentionally omitted — its dev-only double-invoke of
// effects would trigger getUserMedia and the ML model load twice. The engine
// hook's cleanup still disposes correctly on real unmount.
createRoot(document.getElementById('root')!).render(<App />);
