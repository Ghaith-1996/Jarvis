// Compact always-on-top "island": a pill with state and talk/stop, expanding for transcripts, replies and approvals.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { STATE_ICON, STATE_LABEL, useAssistant } from './useAssistant.ts';
import { ApprovalCard } from './Chat.tsx';
import { Elapsed } from './App.tsx';

export function Island() {
  const a = useAssistant('island');
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLTextAreaElement>(null);

  const lastReply = [...a.messages].reverse().find((m) => m.role === 'assistant');
  const streaming = lastReply?.status === 'streaming';

  // Open automatically when there is something to read or decide.
  useEffect(() => { if (a.preview || a.approvals.length || a.notice || streaming) setExpanded(true); }, [a.preview, a.approvals.length, a.notice, streaming]);
  useEffect(() => { if (a.preview) previewRef.current?.focus(); }, [a.preview]);

  // The window is exactly as tall as the content.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => void api.ui.resizeIsland(Math.max(56, Math.min(520, Math.ceil(el.getBoundingClientRect().height) + 4))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!a.settings) return <div className="island" ref={root} />;
  const s = a.settings;
  const recording = a.voice === 'listening' || a.voice === 'opening-mic';
  const pillText = recording || a.voice === 'transcribing' ? STATE_LABEL[a.shownState]
    : streaming && lastReply?.text ? lastReply.text.slice(-70)
    : a.shownState === 'idle' ? `JARVIS · ${s.hotkeys.islandPushToTalk} to talk` : STATE_LABEL[a.shownState];

  return (
    <div className="island" ref={root} data-testid="island-ready">
      <div className={`pill state-${a.shownState}`} role="group" aria-label="JARVIS island">
        <span className="pill-icon" aria-hidden="true">{STATE_ICON[a.shownState]}</span>
        <span className="pill-text" role="status" aria-live="polite">
          {pillText}{a.voice === 'listening' && <Elapsed since={a.recordStart} />}
        </span>
        <button className={recording ? 'pill-btn recording' : 'pill-btn'} aria-pressed={recording} disabled={a.voice === 'transcribing'}
          onClick={() => void (recording ? a.stopRecording() : a.startRecording())} title={`Talk (${s.hotkeys.islandPushToTalk}: press to start, press again to stop)`}>
          {recording ? '■' : '🎤'}<span className="sr-only">{recording ? 'Stop recording' : 'Talk'}</span>
        </button>
        {(a.busy || a.speaking) && <button className="pill-btn danger" onClick={() => void a.stopAll()} title="Stop">⏹<span className="sr-only">Stop</span></button>}
        <button className="pill-btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} title={expanded ? 'Collapse' : 'Expand'}>{expanded ? '▴' : '▾'}<span className="sr-only">{expanded ? 'Collapse' : 'Expand'}</span></button>
        <button className="pill-btn" onClick={() => void a.switchMode('window')} title={`Full window (${s.hotkeys.toggleIsland})`}>⤢<span className="sr-only">Open full window</span></button>
      </div>

      {expanded && (
        <div className="island-panel">
          {a.notice && <div className="notice" role="alert">{a.notice} <button onClick={() => a.setNotice(null)} aria-label="Dismiss notice">✕</button></div>}
          {a.approvals.map((ap) => <ApprovalCard key={ap.id} approval={ap} onNotice={a.setNotice} />)}
          {a.preview ? (
            <div className="preview">
              <label htmlFor="island-preview" className="small">Heard{a.preview.language ? ` (${a.preview.language.toUpperCase()})` : ''}. Edit, then Enter to send:</label>
              <textarea id="island-preview" ref={previewRef} rows={2} value={a.preview.text}
                onChange={(e) => a.setPreview({ ...a.preview!, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (a.preview!.text.trim()) void a.send(a.preview!.text.trim(), true, a.preview!.language); }
                  if (e.key === 'Escape') { e.stopPropagation(); a.setPreview(null); }
                }} />
              <div className="row"><button className="primary" onClick={() => void a.send(a.preview!.text.trim(), true, a.preview!.language)}>Send</button><button onClick={() => a.setPreview(null)}>Discard</button></div>
            </div>
          ) : lastReply?.text ? (
            <div className="island-reply" aria-label="Last reply">{lastReply.text}</div>
          ) : null}
          <form className="row island-input" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { void a.send(draft.trim(), false); setDraft(''); } }}>
            <label htmlFor="island-text" className="sr-only">Message</label>
            <input id="island-text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type to JARVIS…" />
            <button type="submit" disabled={!draft.trim()}>Send</button>
            <button type="button" onClick={() => void a.newConv()} title="New conversation">＋<span className="sr-only">New conversation</span></button>
          </form>
        </div>
      )}
    </div>
  );
}
