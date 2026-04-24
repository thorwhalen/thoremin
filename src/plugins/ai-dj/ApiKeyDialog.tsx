import { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { SetupDialogProps } from '../types';
import { AiDjSettings } from './types';
import { Key, ExternalLink, Shield, Loader2 } from 'lucide-react';

export function ApiKeyDialog({ onSetupComplete, onCancel }: SetupDialogProps<AiDjSettings>) {
  const [key, setKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = key.trim();
    if (!trimmed) return;

    setValidating(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: trimmed, apiVersion: 'v1alpha' });

      // Validate by attempting a connection
      const testSession = await ai.live.music.connect({
        model: 'lyria-realtime-exp',
        callbacks: {
          onmessage: () => {},
          onerror: () => {},
          onclose: () => {},
        },
      });
      // Success — close test session and save key
      testSession.close();
      localStorage.setItem('thoremin:plugin:ai-dj:apiKey', trimmed);
      onSetupComplete();
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('API_KEY_INVALID')) {
        setError('Invalid API key. Double-check that you copied the full key from Google AI Studio.');
      } else if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
        setError('This API key does not have access to the Lyria model. Make sure the Generative Language API is enabled in your Google Cloud project.');
      } else if (msg.includes('network') || msg.includes('fetch')) {
        setError('Network error. Check your internet connection and try again.');
      } else {
        setError(`Unable to connect: ${msg}`);
      }
    } finally {
      setValidating(false);
    }
  };

  return (
    <div
      className="max-w-lg w-full bg-[#111] border border-white/10 p-8 rounded-3xl shadow-2xl"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-purple-500 flex items-center justify-center">
          <Key className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold italic tracking-tighter">AI DJ Setup</h2>
          <p className="text-[10px] text-white/40 uppercase tracking-widest">Gemini API Key Required</p>
        </div>
      </div>

      <div className="space-y-4 text-sm text-white/60 leading-relaxed mb-6">
        <p>
          AI DJ uses Google's <strong className="text-white">Lyria Realtime</strong> model to generate
          music that responds to your vibes in real time. You need a Gemini API key to use it.
        </p>

        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 space-y-2">
          <p className="text-emerald-400 font-bold text-xs uppercase tracking-wider">How to get a key (free)</p>
          <ol className="list-decimal list-inside space-y-1 text-xs text-white/50">
            <li>
              Go to{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 underline inline-flex items-center gap-1"
              >
                Google AI Studio <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>Sign in with your Google account</li>
            <li>Click "Create API Key"</li>
            <li>Copy the key and paste it below</li>
          </ol>
          <p className="text-[10px] text-white/30">At the time of writing, the Lyria Realtime API is free to use.</p>
        </div>

        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-blue-400 font-bold text-xs uppercase tracking-wider">Your key stays local</p>
            <p className="text-xs text-white/50">
              Your API key is stored only in this browser's <code className="text-white/70">localStorage</code>.
              It is sent only to Google's API servers — never to any other server.
              Thoremin has no backend.{' '}
              <a
                href="https://github.com/thorwhalen/thoremin/blob/main/wips/thoremin/WHY_YOUR_API_KEY_IS_SAFE.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline inline-flex items-center gap-1"
              >
                Learn more <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <label className="text-[10px] uppercase tracking-widest text-white/40">Gemini API Key</label>
        <input
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="AIza..."
          className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm font-mono focus:outline-none focus:border-emerald-500 placeholder-white/20"
          autoFocus
        />

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-3 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!key.trim() || validating}
            className="flex-1 py-3 bg-emerald-500 text-black rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-emerald-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {validating && <Loader2 className="w-4 h-4 animate-spin" />}
            {validating ? 'Validating...' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  );
}
