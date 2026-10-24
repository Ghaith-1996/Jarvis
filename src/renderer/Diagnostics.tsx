import { useCallback, useEffect, useState } from 'react';
import { api, errText } from './api.ts';

export function DiagnosticsPage({ onNotice }: { onNotice: (n: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setD(await api.diag.get()); } catch (e) { onNotice(errText(e)); }
    setLoading(false);
  }, [onNotice]);
  useEffect(() => { void load(); }, [load]);

  const exportJson = async () => { try { const p = await api.diag.exportJson(); if (p) onNotice(`Diagnostics saved to ${p} (secrets redacted).`); } catch (e) { onNotice(errText(e)); } };
  const ok = (v: unknown) => (v && typeof v === 'object' && 'error' in (v as object) ? `✕ ${(v as any).error}` : '✓');

  return (
    <section className="diagnostics" aria-labelledby="diag-title">
      <h2 id="diag-title">Diagnostics</h2>
      <div className="row">
        <button onClick={() => void load()} disabled={loading}>{loading ? 'Checking…' : 'Refresh'}</button>
        <button onClick={() => void exportJson()}>Export (redacted)</button>
      </div>
      {d && (
        <>
          <h3>Model access (Codex)</h3>
          <dl>
            <dt>App-server</dt><dd>{d.codex.running ? `running · ${d.codex.userAgent}` : 'not running'}</dd>
            <dt>Account</dt><dd>{ok(d.codex.account)} {d.codex.account?.type ? `${d.codex.account.type}, plan ${d.codex.account.plan}` : ''}</dd>
            <dt>Usage</dt><dd>{ok(d.codex.rateLimits)} {d.codex.rateLimits?.primaryUsedPercent != null ? `${d.codex.rateLimits.primaryUsedPercent}% of the current limit used` : ''}</dd>
            <dt>Models</dt><dd>{Array.isArray(d.codex.models) ? d.codex.models.map((m: any) => m.id).join(', ') : ok(d.codex.models)}</dd>
          </dl>
          <h3>Speech (local)</h3>
          <dl>
            <dt>Speech-to-text</dt><dd>{d.speech.whisper ? `${d.speech.whisperBackend}` : '✕ whisper missing'} {d.speech.asrModel ? '' : '· ✕ model missing'}</dd>
            <dt>Text-to-speech</dt><dd>{d.speech.piper ? '✓ Piper' : '✕ Piper missing'} · voices: {d.speech.voices.join(', ') || 'none'}</dd>
            <dt>Models folder</dt><dd><code>{d.speech.modelsDir}</code></dd>
          </dl>
          <h3>Storage and app</h3>
          <dl>
            <dt>Database</dt><dd><code>{d.storage.database}</code> · {(d.storage.sizeBytes / 1024).toFixed(0)} KB · schema v{d.storage.schemaVersion}</dd>
            <dt>Logs</dt><dd><code>{d.storage.logs}</code></dd>
            <dt>Versions</dt><dd>JARVIS {d.versions.app} · Electron {d.versions.electron} · {d.versions.os}</dd>
            <dt>Assistant</dt><dd>{d.assistant.state} · {d.assistant.pendingApprovals} pending approvals</dd>
          </dl>
          <h3>Recent problems</h3>
          {d.recentProblems.length ? <ul>{d.recentProblems.map((p: any, i: number) => <li key={i}>{new Date(p.ts).toLocaleTimeString()} [{p.level}] {p.msg}</li>)}</ul> : <p className="muted">None.</p>}
          <h3>Recent activity (audit)</h3>
          <ul className="audit">{d.recentAudit.map((a: any, i: number) => <li key={i}>{new Date(a.ts).toLocaleString()} · {a.action}</li>)}</ul>
          <p className="muted">Generated {new Date(d.generatedAt).toLocaleString()}. Nothing here is sent anywhere unless you export and share it.</p>
        </>
      )}
    </section>
  );
}
