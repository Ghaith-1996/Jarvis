// Shared assistant controller for the full window and the island. Only the window matching the current UI mode
// ("owner") records, speaks and handles hotkeys, so audio never plays twice.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Approval, AssistantState, ChatEvent, Lang, Message, Settings } from '../shared/contracts.ts';
import { guessLang, sentences } from '../shared/text.ts';
import { api, errText } from './api.ts';
import { Mic, Player, deviceStatus, listDevices } from './audio.ts';
import { isPlainKey, matchHotkey, releasesHotkey } from './hotkeys.ts';

export type View = 'window' | 'island';
export type Preview = { text: string; language: Lang | null; ms: number };
export type VoiceState = 'idle' | 'opening-mic' | 'listening' | 'transcribing';
type Devices = { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] };

export const STATE_LABEL: Record<AssistantState | 'opening-mic', string> = {
  idle: 'Ready', listening: 'Listening', 'opening-mic': 'Opening microphone', transcribing: 'Transcribing', thinking: 'Thinking',
  'awaiting-approval': 'Waiting for your approval', executing: 'Running an approved action', speaking: 'Speaking', paused: 'Paused', offline: 'Offline', failed: 'Something failed',
};
export const STATE_ICON: Record<string, string> = { idle: '○', listening: '◉', 'opening-mic': '◌', transcribing: '✎', thinking: '…', 'awaiting-approval': '⚠', executing: '▶', speaking: '♪', paused: '❚❚', offline: '⨯', failed: '!' };

export function useAssistant(view: View) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<View>('window');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mainState, setMainState] = useState<{ state: AssistantState; detail?: string }>({ state: 'idle' });
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [voice, setVoice] = useState<VoiceState>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [recordStart, setRecordStart] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [devices, setDevices] = useState<Devices>({ inputs: [], outputs: [] });
  const [online, setOnline] = useState(navigator.onLine);
  const [convsVersion, setConvsVersion] = useState(0);

  const owner = mode === view;
  const mic = useRef(new Mic()).current;
  const player = useRef(new Player()).current;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const currentRef = useRef(currentId);
  currentRef.current = currentId;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const lastInput = useRef<{ voice: boolean; lang: Lang }>({ voice: false, lang: 'fr' });
  const readAlong = useRef(new Map<string, { text: string; spoken: number; read: boolean }>());

  // --- settings, devices, conversation ---
  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    try { setSettings(await api.settings.set(patch)); } catch (e) { setNotice(errText(e)); }
  }, []);

  const refreshDevices = useCallback(async () => {
    try { setDevices(await listDevices()); } catch (e) { setNotice(`Could not list audio devices: ${errText(e)}`); }
  }, []);

  const openConv = useCallback(async (cid: string | null) => {
    const c = cid ? await api.conv.get(cid) : null;
    setCurrentId(c ? c.id : null);
    setMessages(c?.messages ?? []);
    void api.ui.setConversation(c ? c.id : null);
  }, []);

  const newConv = useCallback(async () => {
    const c = await api.conv.create();
    await openConv(c.id);
    setPreview(null);
  }, [openConv]);

  useEffect(() => {
    void (async () => {
      setSettings(await api.settings.get());
      const ui = await api.ui.get();
      setMode(ui.mode);
      if (ui.conversationId) await openConv(ui.conversationId);
      // Device labels are only visible after microphone permission; ask once, release immediately.
      try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); } catch { /* can be granted later from Settings */ }
      await refreshDevices();
      const st = await api.state();
      setMainState({ state: st.state });
      setApprovals(st.approvals);
    })();
    const onChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { navigator.mediaDevices.removeEventListener('devicechange', onChange); removeEventListener('online', on); removeEventListener('offline', off); };
  }, [refreshDevices, openConv]);

  const inStatus = useMemo(() => settings ? deviceStatus({ id: settings.inputDeviceId, label: settings.inputDeviceLabel }, devices.inputs) : { status: 'unset' as const }, [settings, devices]);
  const outStatus = useMemo(() => settings ? deviceStatus({ id: settings.outputDeviceId, label: settings.outputDeviceLabel }, devices.outputs) : { status: 'unset' as const }, [settings, devices]);

  useEffect(() => {
    if (!settings) return;
    player.outputId = outStatus.status === 'ok' ? settings.outputDeviceId : null;
    player.setVolume(settings.outputVolume, settings.muted);
  }, [settings, outStatus, player]);

  // A device vanished mid-use: stop, never reroute.
  useEffect(() => {
    if (inStatus.status !== 'ok' && mic.recording) { mic.close(); setVoice('idle'); setNotice('Microphone disconnected during recording; recording cancelled.'); }
    if (outStatus.status !== 'ok' && player.speaking) { player.stop(); setNotice('Output device disconnected; playback stopped.'); }
  }, [inStatus, outStatus, mic, player]);

  // Losing ownership (mode switched to the other window): release mic and audio here.
  useEffect(() => { if (!owner) { player.stop(); mic.close(); setVoice('idle'); } }, [owner, mic, player]);

  useEffect(() => {
    player.onState = setSpeaking;
    player.onError = (m) => setNotice(`Speech playback: ${m}`);
    mic.onEnded = () => { if (mic.recording) { mic.close(); setVoice('idle'); setNotice('Microphone stopped (unplugged?). Recording cancelled.'); } };
  }, [mic, player]);

  // --- speaking ---
  const speak = useCallback((text: string, langHint?: Lang) => {
    const s = settingsRef.current;
    if (!s || !ownerRef.current) return;
    if (player.outputId === null) return setNotice('Choose an output device in Settings → Devices to hear JARVIS.');
    for (const chunk of sentences(text)) {
      const lang = s.speechLanguage !== 'auto' ? s.speechLanguage : guessLang(chunk, langHint ?? lastInput.current.lang);
      player.enqueue(() => api.speech.synthesize(chunk, lang));
    }
  }, [player]);

  const stopAll = useCallback(async () => {
    player.stop();
    if (mic.recording) { mic.close(); setVoice('idle'); }
    readAlong.current.forEach((r) => (r.read = false));
    await api.chat.interrupt().catch((e) => setNotice(errText(e)));
  }, [mic, player]);

  // --- push-to-talk ---
  const startRecording = useCallback(async () => {
    const s = settingsRef.current;
    if (!s || !ownerRef.current || voice !== 'idle') return;
    if (inStatus.status !== 'ok') return setNotice('Choose a working microphone in Settings → Devices first.');
    player.stop(); // never record our own voice
    setPreview(null);
    setVoice('opening-mic');
    try {
      await mic.open(s.inputDeviceId!);
      mic.start();
      setRecordStart(Date.now());
      setVoice('listening');
    } catch (e) {
      mic.close();
      setVoice('idle');
      setNotice(`Microphone error: ${errText(e)}`);
    }
  }, [voice, inStatus, mic, player]);

  const stopRecording = useCallback(async () => {
    if (voice !== 'listening') return;
    const rec = mic.stop();
    mic.close();
    if (!rec || rec.seconds < 0.4) { setVoice('idle'); return setNotice('Recording too short.'); }
    if (rec.peak < 0.02) { setVoice('idle'); return setNotice('Did not hear anything. Check the microphone or speak closer.'); }
    setVoice('transcribing');
    try {
      const r = await api.speech.transcribe(rec.wav, settingsRef.current!.speechLanguage);
      if (!r.text) setNotice('No speech recognized.');
      else setPreview(r);
    } catch (e) { setNotice(`Transcription failed: ${errText(e)}`); }
    setVoice('idle');
  }, [voice, mic]);

  const cancelRecording = useCallback(() => { mic.close(); setVoice('idle'); setAnnounce('Recording cancelled'); }, [mic]);

  useEffect(() => { // hard cap on recording length
    if (voice !== 'listening') return;
    const t = setTimeout(() => void stopRecording(), 60_000);
    return () => clearTimeout(t);
  }, [voice, stopRecording]);

  const send = useCallback(async (text: string, viaVoice: boolean, lang?: Lang | null) => {
    let cid = currentRef.current;
    if (!cid) { const c = await api.conv.create(); cid = c.id; await openConv(c.id); }
    lastInput.current = { voice: viaVoice, lang: lang ?? guessLang(text, lastInput.current.lang) };
    setPreview(null);
    try { await api.chat.send(cid, text); } catch (e) { setNotice(errText(e)); }
  }, [openConv]);

  // --- events from main ---
  const handlers = useRef({ speak, startRecording, stopRecording, openConv, voice });
  handlers.current = { speak, startRecording, stopRecording, openConv, voice };
  useEffect(() => api.onEvent((ev: ChatEvent) => {
    const s = settingsRef.current;
    const h = handlers.current;
    switch (ev.type) {
      case 'message': {
        const m = ev.message;
        if (m.conversationId !== currentRef.current && m.role === 'user' && ownerRef.current) void h.openConv(m.conversationId);
        if (m.conversationId === currentRef.current) setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms.map((x) => (x.id === m.id ? m : x)) : [...ms, m]));
        if (m.role === 'assistant' && m.status === 'streaming') {
          const read = !!s && (s.readAloud === 'always' || (s.readAloud === 'voice' && lastInput.current.voice));
          readAlong.current.set(m.id, { text: '', spoken: 0, read });
        }
        if (m.role === 'assistant' && m.status !== 'streaming') {
          const r = readAlong.current.get(m.id);
          if (r?.read && m.status === 'complete') { const rest = m.text.slice(r.spoken).trim(); if (rest) h.speak(rest); }
          readAlong.current.delete(m.id);
          if (m.status === 'complete') setAnnounce(`JARVIS: ${m.text.slice(0, 500)}`);
          if (m.status === 'failed') setAnnounce(`Failed: ${m.text}`);
        }
        break;
      }
      case 'delta': {
        if (ev.conversationId === currentRef.current) setMessages((ms) => ms.map((x) => (x.id === ev.messageId ? { ...x, text: x.text + ev.delta } : x)));
        const r = readAlong.current.get(ev.messageId);
        if (r) {
          r.text += ev.delta;
          // Speak each finished sentence as soon as it arrives so audio starts before the reply is complete.
          const last = [...r.text.slice(r.spoken).matchAll(/[.!?…]["»)]?\s/g)].at(-1);
          if (r.read && last) {
            const upto = r.spoken + last.index + last[0].length;
            h.speak(r.text.slice(r.spoken, upto));
            r.spoken = upto;
          }
        }
        break;
      }
      case 'state':
        setMainState({ state: ev.state, detail: ev.detail });
        if (ev.state === 'failed' || ev.state === 'offline') setNotice(ev.detail ?? STATE_LABEL[ev.state]);
        break;
      case 'approval':
        setApprovals((a) => [...a, ev.approval]);
        setAnnounce(`Approval needed: ${ev.approval.summary}`);
        break;
      case 'approval-resolved':
        setApprovals((a) => a.filter((x) => x.id !== ev.id));
        break;
      case 'conversations-changed':
        setConvsVersion((v) => v + 1);
        if (currentRef.current) void api.conv.get(currentRef.current).then((c) => c ? setMessages(c.messages) : (setCurrentId(null), setMessages([])));
        break;
      case 'ui-mode':
        setMode(ev.mode);
        void api.settings.get().then(setSettings); // pick up changes made in the other window
        if (ev.mode === view && ev.conversationId !== currentRef.current) void h.openConv(ev.conversationId);
        break;
      case 'hotkey':
        if (ev.action === 'island-ptt' && ownerRef.current) void (h.voice === 'listening' ? h.stopRecording() : h.voice === 'idle' ? h.startRecording() : undefined);
        break;
    }
  }), [view]);

  // --- in-window hotkeys (owner only; keyboard events only reach the focused window anyway) ---
  useEffect(() => {
    if (!settings || !owner) return;
    const { pushToTalk, stop, newConversation } = settings.hotkeys;
    const inText = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.dataset?.hotkeyCapture) return;
      if (matchHotkey(e, pushToTalk) && !(isPlainKey(pushToTalk) && inText(e.target))) { e.preventDefault(); if (!e.repeat) void startRecording(); }
      else if (matchHotkey(e, stop)) { if (voice === 'listening' || voice === 'opening-mic') cancelRecording(); else if (speaking || mainState.state !== 'idle') void stopAll(); else return; e.preventDefault(); }
      else if (matchHotkey(e, newConversation)) { e.preventDefault(); void newConv(); }
    };
    const up = (e: KeyboardEvent) => { if (releasesHotkey(e, pushToTalk)) void stopRecording(); };
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, [settings, owner, startRecording, stopRecording, cancelRecording, stopAll, newConv, voice, speaking, mainState.state]);

  // --- appearance ---
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.style.setProperty('--font-scale', String(settings.fontScale));
    root.classList.toggle('high-contrast', settings.highContrast);
    root.classList.toggle('reduce-motion', settings.reducedMotion === 'on' || (settings.reducedMotion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches));
  }, [settings]);

  const shownState = voice !== 'idle' ? voice : approvals.length ? 'awaiting-approval' : speaking && mainState.state === 'idle' ? 'speaking' : online ? mainState.state : 'offline';
  const busy = mainState.state !== 'idle' && mainState.state !== 'failed' && mainState.state !== 'offline';

  return {
    settings, updateSettings, devices, refreshDevices, inStatus, outStatus, mode, owner,
    currentId, messages, openConv, newConv, convsVersion,
    mainState, approvals, voice, speaking, recordStart, preview, setPreview, notice, setNotice, announce, online, shownState, busy,
    speak, stopAll, startRecording, stopRecording, cancelRecording, send,
    switchMode: (m: View) => api.ui.setMode(m, currentRef.current),
  };
}
