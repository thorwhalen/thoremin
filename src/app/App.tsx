/**
 * App — the Thoremin instrument view. Hosts the hidden webcam <video>, the
 * overlay <canvas> the DAG draws to, the audio-start gesture button, and the
 * live controls panel. All signal processing happens in the DAG engine via
 * {@link useThoreminEngine}; this component is purely presentational + lifecycle.
 */
import { useThoreminEngine } from './useEngine';
import ControlsPanel from './ControlsPanel';

export default function App() {
  const { videoRef, canvasRef, status, error, audioOn, startAudio } = useThoreminEngine();

  return (
    <div className="min-h-screen bg-[#0a0a0a] font-mono text-white">
      <header className="flex items-center gap-3 border-b border-white/5 px-6 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-black font-black">θ</div>
        <div>
          <h1 className="text-base font-bold uppercase italic tracking-tighter">Thoremin</h1>
          <p className="text-[10px] uppercase tracking-widest text-emerald-500/70">
            DAG sonification · from anything to music
          </p>
        </div>
        <span className="ml-auto text-[10px] uppercase tracking-widest text-white/40">
          {status === 'loading' && 'loading neural engine…'}
          {status === 'ready' && (audioOn ? 'live' : 'ready — start audio')}
          {status === 'error' && 'error'}
        </span>
      </header>

      <main className="flex flex-col items-start gap-6 p-6 lg:flex-row">
        <div className="relative">
          <video ref={videoRef} autoPlay playsInline muted className="hidden" />
          <canvas
            ref={canvasRef}
            width={640}
            height={480}
            className="rounded-3xl border border-white/10 bg-black/40 shadow-2xl"
          />

          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-black/60 backdrop-blur-sm">
              <div className="text-center">
                <div className="mx-auto mb-3 h-12 w-12 animate-spin rounded-full border-4 border-emerald-500/30 border-t-emerald-500" />
                <p className="text-xs uppercase tracking-widest text-emerald-500">Loading neural engine</p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-red-500/10 p-6 text-center backdrop-blur">
              <div>
                <p className="mb-3 text-red-400">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-full bg-red-500 px-5 py-2 text-xs font-bold uppercase tracking-widest"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          <button
            onClick={startAudio}
            disabled={status !== 'ready' || audioOn}
            className={`mt-4 w-full rounded-xl px-6 py-3 text-xs font-bold uppercase tracking-widest transition ${
              audioOn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-500 text-black hover:brightness-110'
            } disabled:opacity-40`}
          >
            {audioOn ? '♪ audio engine active' : 'initialize audio engine'}
          </button>
        </div>

        <ControlsPanel />
      </main>
    </div>
  );
}
