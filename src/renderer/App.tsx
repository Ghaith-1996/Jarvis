import { useCallback, useEffect, useState } from 'react';
import type { ConversationSummary } from '../shared/contracts.ts';
import { api } from './api.ts';
import { STATE_ICON, STATE_LABEL, useAssistant } from './useAssistant.ts';
import { Chat } from './Chat.tsx';
import { SettingsPage } from './Settings.tsx';
import { MemoryPage } from './Memory.tsx';
import { DiagnosticsPage } from './Diagnostics.tsx';

type Page = 'chat' | 'memory' | 'settings' | 'diagnostics';

export function App() {
  const a = useAssistant('window');
  const [page, setPage] = useState<Page>('chat');
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [search, setSearch] = useState('');

  const loadConvs = useCallback(async (q: string) => setConvs(await api.conv.list(q)), []);
  useEffect(() => { const t = setTimeout(() => void loadConvs(search), 200); return () => clearTimeout(t); }, [search, loadConvs, a.convsVersion]);
  useEffect(() => { if (a.approvals.length) setPage('chat'); }, [a.approvals.length]);

  const { settings } = a;
  if (!settings) return <p className="loading">Loading…</p>;

  const deviceBanner =
    a.inStatus.status === 'moved' ? { kind: 'input' as const, text: `Your microphone "${settings.inputDeviceLabel}" reconnected with a new ID.`, candidate: a.inStatus.candidate } :
    a.outStatus.status === 'moved' ? { kind: 'output' as const, text: `Your output "${settings.outputDeviceLabel}" reconnected with a new ID.`, candidate: a.outStatus.candidate } :
    a.inStatus.status === 'missing' ? { kind: 'input' as const, text: `Saved microphone "${settings.inputDeviceLabel}" is not connected. Voice input is off until you choose one.` } :
    a.outStatus.status === 'missing' ? { kind: 'output' as const, text: `Saved output "${settings.outputDeviceLabel}" is not connected. Spoken replies are off until you choose one.` } :
    a.inStatus.status === 'unset' || a.outStatus.status === 'unset' ? { kind: 'setup' as const, text: 'Choose your microphone and speaker in Settings → Devices to use voice. Text chat works without them.' } : null;

  return (
    <div className="app" data-testid="app-ready">
      <a href="#main" className="skip">Skip to main content</a>
      <aside className="sidebar" aria-label="Conversations">
        <h1 className="brand">JARVIS</h1>
        <button onClick={() => void a.newConv().then(() => setPage('chat'))} title={`New conversation (${settings.hotkeys.newConversation})`}>+ New conversation</button>
        <label className="search"><span className="sr-only">Search conversations</span>
          <input type="search" placeholder="Search conversations" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <ul className="conv-list">
          {convs.map((c) => (
            <li key={c.id}>
              <button className={c.id === a.currentId ? 'conv active' : 'conv'} aria-current={c.id === a.currentId ? 'true' : undefined} onClick={() => void a.openConv(c.id).then(() => setPage('chat'))}>
                <span className="conv-title">{c.title}</span>
                {c.snippet && <span className="conv-snippet">{c.snippet.slice(0, 80)}</span>}
              </button>
            </li>
          ))}
          {!convs.length && <li className="muted">{search ? 'No matches.' : 'No conversations yet.'}</li>}
        </ul>
      </aside>

      <div className="content">
        <header className="topbar">
          <nav aria-label="Pages">
            {(['chat', 'memory', 'settings', 'diagnostics'] as Page[]).map((p) => (
              <button key={p} className={page === p ? 'tab active' : 'tab'} aria-current={page === p ? 'page' : undefined} onClick={() => setPage(p)}>{p[0]!.toUpperCase() + p.slice(1)}</button>
            ))}
          </nav>
          <div className="row">
            <div className={`state state-${a.shownState}`} role="status" aria-live="polite">
              <span aria-hidden="true" className="state-icon">{STATE_ICON[a.shownState]}</span> {STATE_LABEL[a.shownState]}
              {a.voice === 'listening' && <Elapsed since={a.recordStart} />}
            </div>
            <button onClick={() => void a.switchMode('island')} title={`Switch to the compact island (${settings.hotkeys.toggleIsland})`}>⇱ Island</button>
          </div>
        </header>

        {deviceBanner && (
          <div className="banner" role="alert">
            {deviceBanner.text}{' '}
            {'candidate' in deviceBanner && deviceBanner.candidate && (
              <button onClick={() => void a.updateSettings(deviceBanner.kind === 'input' ? { inputDeviceId: deviceBanner.candidate!.deviceId } : { outputDeviceId: deviceBanner.candidate!.deviceId })}>Use it</button>
            )}{' '}
            <button onClick={() => setPage('settings')}>Open device settings</button>
          </div>
        )}
        {!a.online && <div className="banner" role="alert">You appear to be offline. Chat needs internet; local speech still works.</div>}
        {a.notice && <div className="notice" role="alert">{a.notice} <button onClick={() => a.setNotice(null)} aria-label="Dismiss notice">✕</button></div>}

        <main id="main" tabIndex={-1}>
          {page === 'chat' && (
            <Chat
              settings={settings} conversationId={a.currentId} title={convs.find((c) => c.id === a.currentId)?.title ?? null} messages={a.messages} approvals={a.approvals}
              busy={a.busy} speaking={a.speaking} voice={a.voice} preview={a.preview} setPreview={a.setPreview}
              onSend={a.send} onStop={() => void a.stopAll()} onSpeak={a.speak} onStartRecording={() => void a.startRecording()} onStopRecording={() => void a.stopRecording()} onCancelRecording={a.cancelRecording}
              onNotice={a.setNotice} onDeleted={() => void a.openConv(null)}
            />
          )}
          {page === 'memory' && <MemoryPage onNotice={a.setNotice} />}
          {page === 'settings' && <SettingsPage settings={settings} update={a.updateSettings} devices={a.devices} refreshDevices={a.refreshDevices} onNotice={a.setNotice} speakPreview={a.speak} />}
          {page === 'diagnostics' && <DiagnosticsPage onNotice={a.setNotice} />}
        </main>
        <div className="sr-only" aria-live="polite">{a.announce}</div>
      </div>
    </div>
  );
}

export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  return <span className="elapsed"> {((now - since) / 1000).toFixed(1)} s</span>;
}
