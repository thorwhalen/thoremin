/**
 * The assistant chat HUD (#87 Phase 3) — a collapsible bottom-right card (the ai-dj
 * overlay's visual shell) that renders the conversation, an inline trace line per
 * command the assistant dispatched, approve/deny cards for destructive commands, and
 * the provider/model + BYO-key controls. It is a thin subscriber to {@link
 * AssistantSession}: it re-renders on the session's coarse `change` event and reads
 * the current state each render. Per the app's UX rules, a turn shows immediate
 * feedback (a "thinking…" pulse), streams text live, and states errors honestly.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ChevronDown, Settings as SettingsIcon, Send, Loader2, Check, X, ExternalLink, Trash2 } from 'lucide-react';
import type { AssistantSession } from './AssistantSession';
import { PROVIDERS, PROVIDER_LIST, recommendedModel, getStoredKey, setStoredKey, removeStoredKey } from './providers';
import type { AssistantSettings, ChatMessage, ProviderId, ToolTrace, PendingApproval } from './types';

interface Props {
  session: AssistantSession;
  settings: AssistantSettings;
  onSettings: (next: AssistantSettings) => void;
  onClose: () => void;
}

export function AssistantOverlayPanel({ session, settings, onSettings, onClose }: Props) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [keyTick, bumpKey] = useReducer((n: number) => n + 1, 0);
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Re-render whenever the session changes (messages stream, traces land, approvals appear).
  useEffect(() => {
    const h = () => force();
    session.addEventListener('change', h);
    return () => session.removeEventListener('change', h);
  }, [session]);

  const provider = PROVIDERS[settings.provider];
  const selectedModel = provider.models.find((m) => m.id === settings.model);
  const hasKey = useMemo(() => !!getStoredKey(settings.provider), [settings.provider, keyTick]);

  // Keep the conversation pinned to the latest content. The last message grows as text
  // streams in and as tool traces land WITHOUT the message count changing, so track that
  // growth explicitly — otherwise the view wouldn't follow a reply while it streams.
  const lastMsg = session.messages[session.messages.length - 1];
  const lastGrowth = (lastMsg?.text.length ?? 0) + (lastMsg?.traces?.length ?? 0);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [session.messages.length, lastGrowth, session.busy, session.pendingApprovals.length]);

  const selectProvider = (id: ProviderId) => {
    onSettings({ provider: id, model: recommendedModel(id) });
    setKeyDraft('');
  };

  const saveKey = () => {
    const k = keyDraft.trim();
    if (!k) return;
    setStoredKey(settings.provider, k);
    setKeyDraft('');
    bumpKey();
  };

  const removeKey = () => {
    removeStoredKey(settings.provider);
    bumpKey();
  };

  const submit = () => {
    if (!input.trim() || session.busy || !hasKey) return;
    void session.send(input, settings);
    setInput('');
  };

  return (
    <div className="absolute bottom-16 right-4 z-40 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111]/95 shadow-2xl backdrop-blur-sm">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-4 py-3">
        <span className="text-xs font-bold uppercase tracking-widest">Assistant</span>
        <div className="flex items-center gap-1">
          <span className="text-[9px] uppercase tracking-widest text-white/30">{provider.label}</span>
          <button
            onClick={() => setShowSettings((s) => !s)}
            aria-label="Assistant settings"
            className={`rounded p-1 transition-colors ${showSettings ? 'bg-emerald-500/20 text-emerald-400' : 'text-white/40 hover:bg-white/10'}`}
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
          <button onClick={onClose} aria-label="Close assistant" className="rounded p-1 text-white/40 transition-colors hover:bg-white/10">
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Settings sub-panel */}
      {showSettings && (
        <div className="shrink-0 space-y-3 border-b border-white/5 px-4 py-3">
          <div className="space-y-1">
            <label className="text-[9px] uppercase tracking-widest text-white/30">Provider</label>
            <select
              value={settings.provider}
              onChange={(e) => selectProvider(e.target.value as ProviderId)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
            >
              {PROVIDER_LIST.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[9px] uppercase tracking-widest text-white/30">Model</label>
            <select
              value={settings.model}
              onChange={(e) => onSettings({ ...settings, model: e.target.value })}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
            >
              {/* The recommended model is marked in the option itself: a native <option>
                  renders no markup, so a "·  recommended" suffix is the only styling a
                  <select> actually honours cross-browser. The chosen model's rationale
                  then shows underneath, so the hint is present without being loud. */}
              {provider.models.map((m) => (
                <option key={m.id} value={m.id} title={m.note}>
                  {m.label}
                  {m.recommended ? '  ·  recommended' : ''}
                </option>
              ))}
            </select>
            {selectedModel && (
              <p className="pt-0.5 text-[9px] leading-snug text-white/30">{selectedModel.note}</p>
            )}
          </div>
          <div className="flex items-center justify-between">
            <a
              href={provider.keyHelpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-emerald-400 underline"
            >
              Get a {provider.label} key <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-[9px] uppercase tracking-widest text-white/30">{hasKey ? 'key set' : 'no key'}</span>
          </div>
          {hasKey && (
            <button onClick={removeKey} className="text-[9px] uppercase tracking-widest text-red-400/50 transition-colors hover:text-red-400">
              Remove {provider.label} key
            </button>
          )}
          <button
            onClick={() => session.clear()}
            className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-white/30 transition-colors hover:text-white/60"
          >
            <Trash2 className="h-3 w-3" /> Clear chat
          </button>
        </div>
      )}

      {/* Body */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {!hasKey ? (
          <KeyGate
            providerId={settings.provider}
            keyDraft={keyDraft}
            setKeyDraft={setKeyDraft}
            onSave={saveKey}
            onSelectProvider={selectProvider}
          />
        ) : session.messages.length === 0 ? (
          <p className="pt-6 text-center text-[11px] leading-relaxed text-white/30">
            Ask me to tune the instrument — e.g. “make the right hand a warm pad two octaves down and turn sync on”.
          </p>
        ) : (
          session.messages.map((m) => (
            <div key={m.id}>
              <MessageBubble message={m} />
            </div>
          ))
        )}

        {/* Pending approvals for destructive commands */}
        {session.pendingApprovals.map((p) => (
          <div key={p.id}>
            <ApprovalCard approval={p} onApprove={() => void session.approve(p.id)} onDeny={() => session.deny(p.id)} />
          </div>
        ))}

        {session.busy && (
          <div className="flex items-center gap-2 text-[11px] text-white/40" aria-busy="true">
            <Loader2 className="h-3 w-3 animate-spin" /> thinking…
          </div>
        )}
      </div>

      {/* Error */}
      {session.error && (
        <div className="shrink-0 border-t border-red-500/20 bg-red-500/10 px-4 py-2">
          <p className="text-[10px] text-red-400">{session.error}</p>
        </div>
      )}

      {/* Input */}
      {hasKey && (
        <div className="flex shrink-0 items-end gap-2 border-t border-white/5 px-3 py-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Tell the instrument what to do…"
            className="max-h-24 flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs placeholder-white/20 focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={submit}
            disabled={!input.trim() || session.busy}
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-black transition-colors hover:bg-emerald-400 disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function KeyGate({
  providerId,
  keyDraft,
  setKeyDraft,
  onSave,
  onSelectProvider,
}: {
  providerId: ProviderId;
  keyDraft: string;
  setKeyDraft: (v: string) => void;
  onSave: () => void;
  onSelectProvider: (id: ProviderId) => void;
}) {
  const provider = PROVIDERS[providerId];
  return (
    <div className="space-y-3 pt-2">
      <p className="text-xs leading-relaxed text-white/60">
        Connect an AI provider to let the assistant play the instrument. Your key is stored only in
        this browser and sent only to the provider you pick — thoremin has no backend.
      </p>

      {/* Make the provider CHOICE obvious right here. */}
      <div className="space-y-1">
        <p className="text-[9px] uppercase tracking-widest text-white/30">Choose a provider</p>
        <div className="flex gap-1.5">
          {PROVIDER_LIST.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectProvider(p.id)}
              className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                p.id === providerId ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/50 hover:text-white/80'
              }`}
            >
              {p.label.replace(/\s*\(.*\)/, '')}
            </button>
          ))}
        </div>
      </div>

      <a
        href={provider.keyHelpUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-400 underline"
      >
        Get a {provider.label} key <ExternalLink className="h-3 w-3" />
      </a>
      <input
        type="password"
        value={keyDraft}
        onChange={(e) => setKeyDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSave()}
        placeholder={provider.keyPlaceholder}
        className="w-full rounded-lg border border-white/10 bg-white/5 p-2 font-mono text-xs placeholder-white/20 focus:border-emerald-500 focus:outline-none"
        autoFocus
      />
      <button
        onClick={onSave}
        disabled={!keyDraft.trim()}
        className="w-full rounded-lg bg-emerald-500 py-2 text-[10px] font-bold uppercase tracking-widest text-black transition-colors hover:bg-emerald-400 disabled:opacity-30"
      >
        Connect {provider.label}
      </button>
      <p className="text-[10px] leading-relaxed text-white/30">
        You can switch provider or model anytime from the{' '}
        <SettingsIcon className="inline h-3 w-3 align-text-bottom" /> settings.
      </p>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex flex-col items-start gap-1'}>
      {message.text && (
        <div
          className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-xs leading-relaxed ${
            isUser ? 'bg-emerald-500/90 text-black' : 'bg-white/10 text-white/90'
          }`}
        >
          {message.text}
        </div>
      )}
      {message.traces && message.traces.length > 0 && (
        <div className="space-y-0.5 pl-1">
          {message.traces.map((t) => (
            <div key={t.id}>
              <TraceLine trace={t} />
            </div>
          ))}
        </div>
      )}
      {!isUser && message.pending && !message.text && (
        <span className="pl-1 text-[11px] text-white/30">…</span>
      )}
    </div>
  );
}

function TraceLine({ trace }: { trace: ToolTrace }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[10px] text-white/40">
      {trace.ok ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <X className="h-3 w-3 text-red-400" />
      )}
      <span className="text-white/50">{trace.command}</span>
      <span className={trace.ok ? 'text-white/30' : 'text-red-400/70'}>{trace.detail}</span>
    </div>
  );
}

function ApprovalCard({
  approval,
  onApprove,
  onDeny,
}: {
  approval: PendingApproval;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
      <p className="text-[11px] text-amber-200/90">
        The assistant wants to <strong>{approval.title.toLowerCase()}</strong>
        {isNamed(approval.params) ? ` “${namedOf(approval.params)}”` : ''}. This can overwrite saved work.
      </p>
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 rounded-lg bg-amber-500 py-1.5 text-[10px] font-bold uppercase tracking-widest text-black transition-colors hover:bg-amber-400"
        >
          Approve
        </button>
        <button
          onClick={onDeny}
          className="flex-1 rounded-lg border border-white/10 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/5"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function isNamed(params: unknown): boolean {
  return !!params && typeof params === 'object' && 'name' in (params as Record<string, unknown>);
}
function namedOf(params: unknown): string {
  return String((params as Record<string, unknown>).name);
}
