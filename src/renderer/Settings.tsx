import { useEffect, useRef, useState } from 'react';
import type { Lang, Pronunciation, Settings, Voice } from '../shared/contracts.ts';
import { api, errText } from './api.ts';
import { Mic, Player } from './audio.ts';
import { formatHotkey } from './hotkeys.ts';

type Props = {
  settings: Settings; update: (p: Partial<Settings>) => Promise<void>;
  devices: { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }; refreshDevices: () => Promise<void>;
  onNotice: (n: string) => void; speakPreview: (text: string, lang?: Lang) => void;
};

const PREVIEW_TEXT: Record<Lang, string> = { fr: "Bonjour, je suis JARVIS. Le rendez-vous est demain à 14 h 30.", en: "Hello, I'm JARVIS. Your meeting is tomorrow at 9:45 AM." };

export function SettingsPage({ settings: s, update, devices, refreshDevices, onNotice }: Props) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [models, setModels] = useState<string[] | null>(null);
  const [speechDir, setSpeechDir] = useState<{ modelsDir: string; whisperBackend: string; piper: boolean } | null>(null);
  const [effective, setEffective] = useState<string>('');
  useEffect(() => {
    void api.speech.voices().then(setVoices).catch((e) => onNotice(errText(e)));
    void api.diag.get().then((d) => {
      setModels(Array.isArray(d?.codex?.models) ? d.codex.models.map((m: any) => m.id) : []);
      setSpeechDir(d?.speech ?? null);
    }).catch(() => setModels([]));
  }, [onNotice]);

  const chooseSpeechDir = async () => {
    try {
      const h = await api.speech.chooseModelsDir();
      if (!h) return;
      setSpeechDir(h);
      setVoices(await api.speech.voices());
      onNotice(h.piper && h.whisperBackend !== 'missing' ? 'Speech files found.' : 'That folder is missing whisper or Piper files; voice will not work until it has them.');
    } catch (e) { onNotice(errText(e)); }
  };

  return (
    <section className="settings" aria-labelledby="settings-title">
      <h2 id="settings-title">Settings</h2>
      <DevicesSection s={s} update={update} devices={devices} refreshDevices={refreshDevices} onNotice={onNotice} />

      <fieldset>
        <legend>Language and voice</legend>
        <label>Speech language
          <select value={s.speechLanguage} onChange={(e) => void update({ speechLanguage: e.target.value as Settings['speechLanguage'] })}>
            <option value="auto">Detect automatically (French or English)</option>
            <option value="fr">Always French</option>
            <option value="en">Always English</option>
          </select>
        </label>
        <label>French spelling
          <select value={s.frLocale} onChange={(e) => void update({ frLocale: e.target.value as Settings['frLocale'] })}>
            <option value="fr-FR">France (fr-FR)</option>
            <option value="fr-CA">Canada (fr-CA)</option>
          </select>
        </label>
        {(['fr', 'en'] as Lang[]).map((lang) => (
          <div className="row" key={lang}>
            <label>{lang === 'fr' ? 'French voice' : 'English voice'}
              <select value={lang === 'fr' ? s.voiceFr : s.voiceEn} onChange={(e) => void update(lang === 'fr' ? { voiceFr: e.target.value } : { voiceEn: e.target.value })}>
                {voices.filter((v) => v.lang === lang).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
            <PreviewButton lang={lang} voice={lang === 'fr' ? s.voiceFr : s.voiceEn} s={s} onNotice={onNotice} />
          </div>
        ))}
        <label>Speaking speed: {s.speechRate.toFixed(2)}×
          <input type="range" min={0.5} max={2} step={0.05} value={s.speechRate} onChange={(e) => void update({ speechRate: +e.target.value })} />
        </label>
        <label>Read replies aloud
          <select value={s.readAloud} onChange={(e) => void update({ readAloud: e.target.value as Settings['readAloud'] })}>
            <option value="voice">After I speak to JARVIS</option>
            <option value="always">Always</option>
            <option value="never">Never (use the Speak buttons)</option>
          </select>
        </label>
        <Pronunciations rules={s.pronunciations} update={(r) => void update({ pronunciations: r })} />
        <h3>Speech files</h3>
        <p>{speechDir ? <><code>{speechDir.modelsDir}</code> · speech-to-text: {speechDir.whisperBackend} · voices: {speechDir.piper ? 'found' : 'missing'}</> : 'Checking…'}</p>
        <button onClick={() => void chooseSpeechDir()}>Choose folder…</button>
      </fieldset>

      <fieldset>
        <legend>Model</legend>
        <label>Model
          <select value={s.model ?? ''} onChange={(e) => void update({ model: e.target.value || null })}>
            <option value="">Account default</option>
            {(models ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            {s.model && models && !models.includes(s.model) && <option value={s.model}>{s.model} (not listed)</option>}
          </select>
        </label>
        <label>Reasoning effort
          <select value={s.effort} onChange={(e) => void update({ effort: e.target.value as Settings['effort'] })}>
            <option value="low">Low (fastest replies)</option>
            <option value="medium">Medium</option>
            <option value="high">High (slower)</option>
          </select>
        </label>
        <p className="muted">Uses your ChatGPT plan through Codex. JARVIS never falls back to a paid API. Usage is shown on the Diagnostics page.</p>
      </fieldset>

      <fieldset>
        <legend>Keyboard shortcuts</legend>
        {([
          ['pushToTalk', 'Push to talk (hold, in the full window)'],
          ['stop', 'Stop / cancel'],
          ['newConversation', 'New conversation'],
          ['islandPushToTalk', 'Push to talk anywhere in island mode (press to start, press again to stop)'],
          ['toggleIsland', 'Switch between island and full window (works from any app)'],
        ] as const).map(([k, label]) => (
          <label key={k}>{label}
            <input readOnly value={s.hotkeys[k]} data-hotkey-capture="1" aria-description="Focus and press the new key combination"
              onKeyDown={(e) => {
                if (e.key === 'Tab') return;
                e.preventDefault();
                const combo = formatHotkey(e);
                if (combo) void update({ hotkeys: { ...s.hotkeys, [k]: combo } });
              }} />
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Accessibility</legend>
        <label>Text size: {Math.round(s.fontScale * 100)}%
          <input type="range" min={0.8} max={1.6} step={0.05} value={s.fontScale} onChange={(e) => void update({ fontScale: +e.target.value })} />
        </label>
        <label className="check"><input type="checkbox" checked={s.highContrast} onChange={(e) => void update({ highContrast: e.target.checked })} /> High contrast</label>
        <label>Reduce motion
          <select value={s.reducedMotion} onChange={(e) => void update({ reducedMotion: e.target.value as Settings['reducedMotion'] })}>
            <option value="system">Follow Windows</option><option value="on">On</option><option value="off">Off</option>
          </select>
        </label>
        <p className="muted">Everything JARVIS says is also written in the chat (captions). States are shown as text, not only color.</p>
      </fieldset>

      <fieldset>
        <legend>Privacy, permissions and logs</legend>
        <ul className="facts">
          <li>Microphone opens only while you hold push-to-talk or run a device test.</li>
          <li>Recorded audio is transcribed on this PC and deleted immediately; nothing is kept.</li>
          <li>Only your messages and saved memory items are sent to OpenAI through Codex. No telemetry.</li>
          <li>JARVIS cannot change files or run modifying commands without an approval card. Codex runs read-only.</li>
        </ul>
        <label>Approval cards expire after (seconds)
          <input type="number" min={30} max={3600} value={s.approvalTimeoutSec} onChange={(e) => +e.target.value >= 30 && void update({ approvalTimeoutSec: +e.target.value })} />
        </label>
        <label>Log detail
          <select value={s.logLevel} onChange={(e) => void update({ logLevel: e.target.value as Settings['logLevel'] })}><option value="info">Normal</option><option value="debug">Debug</option></select>
        </label>
        <label>Keep logs for (days)
          <input type="number" min={1} max={365} value={s.logRetentionDays} onChange={(e) => +e.target.value >= 1 && void update({ logRetentionDays: +e.target.value })} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Startup</legend>
        <label className="check"><input type="checkbox" checked={s.startAtLogin} onChange={(e) => void update({ startAtLogin: e.target.checked })} /> Start JARVIS when I sign in to Windows</label>
      </fieldset>

      <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void api.settings.effective().then((c) => setEffective(JSON.stringify(c, null, 2))); }}>
        <summary>Effective configuration</summary>
        <pre className="config">{effective || 'Loading…'}</pre>
      </details>
    </section>
  );
}

function DevicesSection({ s, update, devices, refreshDevices, onNotice }: Pick<Props, 'update' | 'devices' | 'refreshDevices' | 'onNotice'> & { s: Settings }) {
  const mic = useRef(new Mic()).current;
  const player = useRef(new Player()).current;
  const [meterOn, setMeterOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);

  useEffect(() => () => mic.close(), [mic]);
  useEffect(() => { player.outputId = s.outputDeviceId; player.setVolume(s.outputVolume, s.muted); }, [s, player]);

  const openMeter = async (on: boolean) => {
    mic.close();
    setMeterOn(false);
    setLevel(0);
    if (!on) return;
    if (!s.inputDeviceId) return onNotice('Choose a microphone first.');
    try { mic.onLevel = setLevel; await mic.open(s.inputDeviceId); setMeterOn(true); } catch (e) { onNotice(`Microphone error: ${errText(e)}`); }
  };

  const testRecord = async () => {
    if (!s.inputDeviceId || !s.outputDeviceId) return onNotice('Choose both a microphone and an output first.');
    setTesting(true);
    try {
      mic.onLevel = setLevel;
      await mic.open(s.inputDeviceId);
      setMeterOn(true);
      mic.start();
      await new Promise((r) => setTimeout(r, 3000));
      const rec = mic.stop();
      mic.close();
      setMeterOn(false);
      if (!rec) throw new Error('nothing recorded');
      onNotice(`Recorded 3 s, peak level ${rec.peak.toFixed(2)}${rec.peak < 0.02 ? ' (near silent: wrong or muted mic?)' : ''}. Playing it back on the chosen output.`);
      player.enqueue(async () => rec.wav);
    } catch (e) { onNotice(`Test failed: ${errText(e)}`); }
    setTesting(false);
  };

  const select = (kind: 'input' | 'output', list: MediaDeviceInfo[], value: string | null, label: string | null) => (
    <select value={value ?? ''} onChange={(e) => {
      const id = e.target.value || null;
      const lab = id === 'default' ? 'System default' : list.find((d) => d.deviceId === id)?.label ?? null;
      void update(kind === 'input' ? { inputDeviceId: id, inputDeviceLabel: lab } : { outputDeviceId: id, outputDeviceLabel: lab });
      if (kind === 'input') void openMeter(false);
    }}>
      <option value="" disabled>Choose…</option>
      <option value="default">System default (follows Windows, may change)</option>
      {list.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || '(unnamed device)'}</option>)}
      {value && value !== 'default' && !list.some((d) => d.deviceId === value) && <option value={value}>{label ?? 'Saved device'} (not connected)</option>}
    </select>
  );

  return (
    <fieldset>
      <legend>Devices</legend>
      <label>Microphone (input) {select('input', devices.inputs, s.inputDeviceId, s.inputDeviceLabel)}</label>
      <div className="row">
        <label className="check"><input type="checkbox" checked={meterOn} disabled={testing} onChange={(e) => void openMeter(e.target.checked)} /> Show live level (turns the microphone on)</label>
        <meter min={0} max={1} value={Math.min(1, level * 3)} aria-label="Microphone level" />
      </div>
      <label>Output (speakers or headphones) {select('output', devices.outputs, s.outputDeviceId, s.outputDeviceLabel)}</label>
      <label>Voice volume: {Math.round(s.outputVolume * 100)}%
        <input type="range" min={0} max={1} step={0.05} value={s.outputVolume} onChange={(e) => void update({ outputVolume: +e.target.value })} />
      </label>
      <label className="check"><input type="checkbox" checked={s.muted} onChange={(e) => void update({ muted: e.target.checked })} /> Mute JARVIS</label>
      <div className="row">
        <button onClick={() => void testRecord()} disabled={testing}>{testing ? 'Recording 3 s… speak now' : 'Test: record 3 s and play back'}</button>
        <button onClick={() => { player.enqueue(() => api.speech.synthesize(PREVIEW_TEXT.en, 'en')); }}>Play test voice</button>
        <button onClick={() => void refreshDevices()}>Refresh device list</button>
      </div>
      <p className="muted">JARVIS never switches devices on its own. If a device disconnects, voice stops and you are asked what to use.</p>
    </fieldset>
  );
}

function PreviewButton({ lang, voice, s, onNotice }: { lang: Lang; voice: string; s: Settings; onNotice: (n: string) => void }) {
  const player = useRef(new Player()).current;
  useEffect(() => { player.outputId = s.outputDeviceId; player.setVolume(s.outputVolume, s.muted); }, [s, player]);
  return (
    <button onClick={() => {
      if (!s.outputDeviceId) return onNotice('Choose an output device first.');
      player.stop();
      player.enqueue(() => api.speech.synthesize(PREVIEW_TEXT[lang], lang, voice));
    }}>Preview</button>
  );
}

function Pronunciations({ rules, update }: { rules: Pronunciation[]; update: (r: Pronunciation[]) => void }) {
  const [draft, setDraft] = useState<Pronunciation>({ lang: 'fr', from: '', to: '' });
  return (
    <div className="pron">
      <h3>Pronunciation rules</h3>
      <p className="muted">Replace a word before it is spoken, e.g. “PDF” → “pé dé èf”. Whole words, per language.</p>
      <table>
        <thead><tr><th scope="col">Language</th><th scope="col">Written</th><th scope="col">Say</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={i}><td>{r.lang.toUpperCase()}</td><td>{r.from}</td><td>{r.to}</td>
              <td><button onClick={() => update(rules.filter((_, j) => j !== i))} aria-label={`Remove rule ${r.from}`}>Remove</button></td></tr>
          ))}
          <tr>
            <td><select aria-label="Language" value={draft.lang} onChange={(e) => setDraft({ ...draft, lang: e.target.value as Lang })}><option value="fr">FR</option><option value="en">EN</option></select></td>
            <td><input aria-label="Written word" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></td>
            <td><input aria-label="How to say it" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></td>
            <td><button disabled={!draft.from.trim() || !draft.to.trim()} onClick={() => { update([...rules, { ...draft, from: draft.from.trim(), to: draft.to.trim() }]); setDraft({ ...draft, from: '', to: '' }); }}>Add</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
