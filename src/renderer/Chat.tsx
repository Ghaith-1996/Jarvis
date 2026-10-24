import { useEffect, useRef, useState } from 'react';
import type { Approval, Lang, Message, Settings } from '../shared/contracts.ts';
import { api, errText } from './api.ts';
import type { Preview } from './useAssistant.ts';

type Props = {
  settings: Settings; conversationId: string | null; title: string | null; messages: Message[]; approvals: Approval[];
  busy: boolean; speaking: boolean; voice: 'idle' | 'opening-mic' | 'listening' | 'transcribing';
  preview: Preview | null; setPreview: (p: Preview | null) => void;
  onSend: (text: string, viaVoice: boolean, lang?: Lang | null) => void; onStop: () => void; onSpeak: (text: string) => void;
  onStartRecording: () => void; onStopRecording: () => void; onCancelRecording: () => void;
  onNotice: (n: string) => void; onDeleted: () => void;
};

export function Chat(p: Props) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const previewRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { listRef.current?.lastElementChild?.scrollIntoView({ block: 'end' }); }, [p.messages]);
  useEffect(() => { if (p.preview) previewRef.current?.focus(); }, [p.preview]);

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    p.onSend(t, false);
    setDraft('');
  };

  const saveEdit = async () => {
    if (!editing || !p.conversationId) return;
    const idx = p.messages.findIndex((m) => m.id === editing.id);
    if (idx < p.messages.length - 2 && !confirm('Editing this prompt removes every message after it. Continue?')) return;
    try { await api.chat.edit(p.conversationId, editing.id, editing.text.trim()); setEditing(null); } catch (e) { p.onNotice(errText(e)); }
  };

  const remember = async (m: Message) => {
    const text = prompt('Save to memory (edit if needed):', m.text.slice(0, 500));
    if (!text?.trim()) return;
    await api.memory.add('fact', text.trim(), `conversation: ${p.title ?? 'untitled'}`);
    p.onNotice('Saved to memory. It applies to new conversations.');
  };

  const speakSelection = () => {
    const t = getSelection()?.toString().trim();
    if (t) p.onSpeak(t); else p.onNotice('Select some text first, then choose “Speak selection”.');
  };

  const exportMd = async () => {
    if (!p.conversationId) return;
    try { const path = await api.conv.exportMd(p.conversationId); if (path) p.onNotice(`Exported to ${path}`); } catch (e) { p.onNotice(errText(e)); }
  };

  const remove = async () => {
    if (!p.conversationId || !confirm('Delete this conversation? This cannot be undone.')) return;
    await api.conv.remove(p.conversationId);
    p.onDeleted();
  };

  const recording = p.voice === 'listening' || p.voice === 'opening-mic';

  return (
    <section className="chat" aria-labelledby="chat-title">
      <div className="chat-head">
        <h2 id="chat-title">{p.title ?? 'New conversation'}</h2>
        <div className="row">
          <button onClick={speakSelection}>Speak selection</button>
          <button onClick={() => void exportMd()} disabled={!p.conversationId}>Export</button>
          <button onClick={() => void remove()} disabled={!p.conversationId}>Delete</button>
        </div>
      </div>

      <ol className="messages" ref={listRef} aria-label="Messages">
        {!p.messages.length && <li className="muted empty">Type below, or hold {p.settings.hotkeys.pushToTalk} to talk. French and English both work.</li>}
        {p.messages.map((m) => (
          <li key={m.id} className={`msg msg-${m.role} status-${m.status}`}>
            <div className="msg-meta">
              <strong>{m.role === 'user' ? 'You' : 'JARVIS'}</strong>
              {m.status !== 'complete' && <span className="tag">{m.status === 'streaming' ? 'writing…' : m.status}</span>}
            </div>
            {editing?.id === m.id ? (
              <div className="edit">
                <label className="sr-only" htmlFor={`edit-${m.id}`}>Edit prompt</label>
                <textarea id={`edit-${m.id}`} value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} rows={3} autoFocus />
                <div className="row"><button onClick={() => void saveEdit()} disabled={!editing.text.trim()}>Save and resend</button><button onClick={() => setEditing(null)}>Cancel</button></div>
              </div>
            ) : (
              <div className="msg-text">{m.text || (m.status === 'streaming' ? '…' : '')}</div>
            )}
            {m.status !== 'streaming' && editing?.id !== m.id && (
              <div className="msg-actions">
                {m.role === 'assistant' && m.text && <button onClick={() => p.onSpeak(m.text)}>Speak</button>}
                <button onClick={() => void navigator.clipboard.writeText(m.text)}>Copy</button>
                <button onClick={() => void remember(m)}>Remember this</button>
                {m.role === 'user' && !p.busy && <button onClick={() => setEditing({ id: m.id, text: m.text })}>Edit</button>}
              </div>
            )}
          </li>
        ))}
      </ol>

      {p.approvals.map((a) => <ApprovalCard key={a.id} approval={a} onNotice={p.onNotice} />)}

      {p.preview && (
        <div className="preview" role="group" aria-label="Transcript preview">
          <label htmlFor="preview-text">
            Heard{p.preview.language ? ` (${p.preview.language === 'fr' ? 'French' : 'English'})` : ''} in {(p.preview.ms / 1000).toFixed(1)} s. Correct it if needed, then send:
          </label>
          <textarea id="preview-text" ref={previewRef} value={p.preview.text} rows={3}
            onChange={(e) => p.setPreview({ ...p.preview!, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (p.preview!.text.trim()) p.onSend(p.preview!.text.trim(), true, p.preview!.language); }
              if (e.key === 'Escape') { e.stopPropagation(); p.setPreview(null); }
            }} />
          <div className="row">
            <button className="primary" onClick={() => p.onSend(p.preview!.text.trim(), true, p.preview!.language)} disabled={!p.preview.text.trim()}>Send</button>
            <button onClick={() => p.setPreview(null)}>Discard</button>
          </div>
        </div>
      )}

      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor="composer-text" className="sr-only">Message</label>
        <textarea id="composer-text" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Message JARVIS (Enter to send, Shift+Enter for a new line)"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <div className="composer-buttons">
          <button type="submit" className="primary" disabled={!draft.trim()}>Send{p.busy ? ' (queued)' : ''}</button>
          <button type="button" className={recording ? 'mic recording' : 'mic'} aria-pressed={recording} disabled={p.voice === 'transcribing'}
            onClick={() => (recording ? p.onStopRecording() : p.onStartRecording())}>
            {p.voice === 'transcribing' ? 'Transcribing…' : recording ? '■ Stop recording' : `🎤 Talk (${p.settings.hotkeys.pushToTalk})`}
          </button>
          {recording && <button type="button" onClick={p.onCancelRecording}>Cancel recording</button>}
          {(p.busy || p.speaking) && <button type="button" className="danger" onClick={p.onStop}>Stop ({p.settings.hotkeys.stop})</button>}
        </div>
      </form>
    </section>
  );
}

export function ApprovalCard({ approval: a, onNotice }: { approval: Approval; onNotice: (n: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(Math.round((a.expiresAt - Date.now()) / 1000));
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { const t = setInterval(() => setLeft(Math.max(0, Math.round((a.expiresAt - Date.now()) / 1000))), 1000); return () => clearInterval(t); }, [a.expiresAt]);
  const decide = (d: 'accept' | 'decline') => api.approval.decide(a.id, d, a.payloadHash).catch((e) => onNotice(errText(e)));
  return (
    <div className="approval" role="alertdialog" aria-labelledby={`ap-${a.id}`} aria-describedby={`apd-${a.id}`} tabIndex={-1} ref={ref}>
      <h3 id={`ap-${a.id}`}>⚠ Approval needed: {a.kind === 'command' ? 'run a command' : 'change files'}</h3>
      <div id={`apd-${a.id}`}>
        <pre className="exact">{a.summary}</pre>
        {a.cwd && <p>In: <code>{a.cwd}</code></p>}
        {a.reason && <p>Reason given: {a.reason}</p>}
        <p className="muted">Applies once, to exactly this request. Expires in {left} s (then declined).</p>
      </div>
      <div className="row">
        <button className="primary" onClick={() => void decide('accept')}>Approve once</button>
        <button onClick={() => void decide('decline')}>Decline</button>
      </div>
    </div>
  );
}
