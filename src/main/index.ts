// Electron main process: window, security policy, IPC allowlist, settings, diagnostics, self-test.
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, screen, session, shell, type IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { id, normalizeSettings, num, oneOf, str, validateSettingsPatch, type ChatEvent, type Settings } from '../shared/contracts.ts';
import { openDb, type Db } from './db.ts';
import { initLog, log, logDir, recentProblems, setLogLevel, redact } from './log.ts';
import { CodexClient, CODEX_EXE } from './codex.ts';
import { Assistant, friendlyError } from './assistant.ts';
import { Speech } from './speech.ts';

const ORIGIN = 'app://jarvis';
const DIST = __dirname;
const SELFTEST = process.argv.includes('--selftest');
const SELFTEST_TURN = process.argv.includes('--selftest-turn');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!SELFTEST && !app.requestSingleInstanceLock()) app.quit();

let db: Db;
let settings: Settings;
let win: BrowserWindow | null = null;
let island: BrowserWindow | null = null;
let currentConversationId: string | null = null; // handed between the full window and the island on mode switch
let codex: CodexClient;
let assistant: Assistant;
let speech: Speech;

const emit = (ev: ChatEvent) => { win?.webContents.send('event', ev); island?.webContents.send('event', ev); };

/**
 * Folder holding whisper/Piper executables and models. Chosen only via a native dialog in main (never by the renderer),
 * because JARVIS runs executables from it.
 */
function modelsDir() {
  const chosen = db.loadSettings().modelsDir;
  if (process.env.JARVIS_MODELS_DIR) return process.env.JARVIS_MODELS_DIR;
  if (typeof chosen === 'string') return chosen;
  const exeDir = dirname(app.getPath('exe'));
  // Packaged: a "models" folder next to the exe, else the repo's .models when the exe still sits in <repo>/out/JARVIS-win32-x64.
  const candidates = app.isPackaged ? [join(exeDir, 'models'), join(exeDir, '..', '..', '.models')] : [join(app.getAppPath(), '.models')];
  return candidates.find((d) => existsSync(d)) ?? candidates[0]!;
}

function applySettings(patch: Partial<Settings>) {
  const before = settings;
  settings = { ...settings, ...patch };
  db.saveSettings(patch);
  db.audit('settings-changed', { keys: Object.keys(patch) });
  if (patch.logLevel) setLogLevel(patch.logLevel);
  if (patch.startAtLogin !== undefined && patch.startAtLogin !== before.startAtLogin) app.setLoginItemSettings({ openAtLogin: patch.startAtLogin });
  if (patch.uiMode && patch.uiMode !== before.uiMode) showMode();
  if (patch.hotkeys || patch.uiMode) registerGlobalShortcuts();
  return settings;
}

// --- full window vs island ---

const accel = (combo: string) => combo.replace(/Ctrl/g, 'Control');

/** System-wide shortcuts: toggle island always; island push-to-talk only while the island is shown (it steals the key). */
function registerGlobalShortcuts() {
  globalShortcut.unregisterAll();
  const reg = (combo: string, fn: () => void) => {
    try { if (!globalShortcut.register(accel(combo), fn)) log('warn', 'global shortcut unavailable (used by another app?)', { combo }); }
    catch (e) { log('warn', 'invalid global shortcut', { combo, message: (e as Error).message }); }
  };
  reg(settings.hotkeys.toggleIsland, () => applySettings({ uiMode: settings.uiMode === 'island' ? 'window' : 'island' }));
  if (settings.uiMode === 'island') reg(settings.hotkeys.islandPushToTalk, () => island?.webContents.send('event', { type: 'hotkey', action: 'island-ptt' } satisfies ChatEvent));
}

function showMode() {
  if (settings.uiMode === 'island') {
    island ??= createIsland();
    win?.hide();
    island.showInactive();
  } else {
    island?.hide();
    if (!win) createWindow();
    win!.show();
    win!.focus();
  }
  emit({ type: 'ui-mode', mode: settings.uiMode, conversationId: currentConversationId });
}

const ISLAND_WIDTH = 460;
function placeIsland(height: number) {
  const area = screen.getPrimaryDisplay().workArea;
  island?.setBounds({ x: Math.round(area.x + (area.width - ISLAND_WIDTH) / 2), y: area.y + 8, width: ISLAND_WIDTH, height: Math.round(height) });
}

function createIsland() {
  const w = new BrowserWindow({
    width: ISLAND_WIDTH, height: 56, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false, title: 'JARVIS island',
    webPreferences: { preload: join(DIST, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  w.setAlwaysOnTop(true, 'floating');
  w.on('closed', () => { island = null; });
  island = w;
  placeIsland(56);
  void w.loadURL(`${ORIGIN}/index.html?view=island`);
  return w;
}

function effectiveConfig() {
  return {
    settings,
    paths: { userData: app.getPath('userData'), database: join(app.getPath('userData'), 'jarvis.db'), logs: logDir(), models: modelsDir(), workspace: workspaceDir() },
    model: { provider: 'Codex app-server (ChatGPT login, route A)', codexExe: CODEX_EXE, sandbox: 'read-only', approvalPolicy: 'untrusted', approvalsReviewer: 'user', paidApiFallback: 'disabled' },
    privacy: { telemetry: 'none', rawAudioRetention: 'none (temp file deleted after each call)', screenCapture: 'none', logRedaction: 'on' },
    renderer: { contextIsolation: true, sandbox: true, nodeIntegration: false, csp: "default-src 'none'; script-src 'self'; style-src 'self'; media-src 'self' blob:; img-src 'self' data:" },
  };
}

const workspaceDir = () => join(app.getPath('userData'), 'workspace');

async function diagnostics() {
  const safe = async <T>(f: () => Promise<T>) => { try { return await f(); } catch (e) { return { error: friendlyError(e) }; } };
  const dbPath = join(app.getPath('userData'), 'jarvis.db');
  return {
    generatedAt: new Date().toISOString(),
    versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, os: `${process.platform} ${process.getSystemVersion()}` },
    codex: { running: codex.running, userAgent: codex.userAgent, account: await safe(() => codex.account()), rateLimits: await safe(async () => { const r = await codex.rateLimits(); return { primaryUsedPercent: r.primaryUsedPercent, secondaryUsedPercent: r.secondaryUsedPercent }; }), models: await safe(() => codex.models()) },
    speech: speech.health(),
    storage: { database: dbPath, sizeBytes: statSync(dbPath).size, schemaVersion: db.schemaVersion, logs: logDir() },
    assistant: { state: assistant.state, pendingApprovals: assistant.pendingApprovals().length },
    recentProblems: recentProblems(),
    recentAudit: db.recentAudit(20),
  };
}

function conversationMarkdown(convId: string) {
  const c = db.getConversation(convId);
  if (!c) throw new Error('unknown conversation');
  const lines = [`# ${c.title}`, '', `Exported ${new Date().toISOString()} from JARVIS`, ''];
  for (const m of c.messages) lines.push(`## ${m.role === 'user' ? 'You' : 'JARVIS'} · ${new Date(m.createdAt).toLocaleString()}${m.status !== 'complete' ? ` (${m.status})` : ''}`, '', m.text, '');
  return { title: c.title, text: lines.join('\n') };
}

/** Every handler checks the sender is our own page; arguments are validated in each handler. */
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (e: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!e.senderFrame?.url.startsWith(`${ORIGIN}/`)) throw new Error('forbidden sender');
    try { return await fn(...args); } catch (err) {
      log('warn', `ipc ${channel} failed`, { message: (err as Error).message });
      throw new Error(friendlyError(err));
    }
  });
}

function registerIpc() {
  handle('settings:get', () => settings);
  handle('settings:set', (patch: unknown) => applySettings(validateSettingsPatch(patch)));
  handle('config:effective', () => effectiveConfig());
  handle('state:get', () => ({ state: assistant.state, approvals: assistant.pendingApprovals() }));
  handle('ui:get', () => ({ mode: settings.uiMode, conversationId: currentConversationId }));
  handle('ui:setMode', (mode: unknown, cid: unknown) => {
    currentConversationId = cid === null || cid === undefined ? null : id(cid);
    applySettings({ uiMode: oneOf(mode, ['window', 'island'] as const, 'mode') });
  });
  handle('ui:setConversation', (cid: unknown) => { currentConversationId = cid === null ? null : id(cid); });
  handle('island:resize', (h: unknown) => placeIsland(num(h, 40, 520, 'height')));

  handle('conv:list', (q: unknown) => db.listConversations(q === undefined ? '' : str(q, 'query', 200)));
  handle('conv:get', (cid: unknown) => db.getConversation(id(cid)));
  handle('conv:create', () => { const c = db.createConversation(); emit({ type: 'conversations-changed' }); return c; });
  handle('conv:delete', (cid: unknown) => { db.deleteConversation(id(cid)); db.audit('conversation-deleted', { id: cid }); emit({ type: 'conversations-changed' }); });
  handle('conv:export', async (cid: unknown) => {
    const { title, text } = conversationMarkdown(id(cid));
    const r = await dialog.showSaveDialog(win!, { defaultPath: `${title.replace(/[^\p{L}\p{N} _-]+/gu, '').slice(0, 50) || 'conversation'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, text, 'utf8');
    db.audit('conversation-exported', { id: cid, path: r.filePath });
    return r.filePath;
  });

  handle('chat:send', (cid: unknown, text: unknown) => {
    const t = str(text, 'message', 50_000).trim();
    if (!t) throw new Error('empty message');
    assistant.send(id(cid), t);
  });
  handle('chat:edit', (cid: unknown, mid: unknown, text: unknown) => assistant.editAndResend(id(cid), id(mid), str(text, 'message', 50_000)));
  handle('chat:interrupt', () => assistant.interrupt());
  handle('approval:decide', (aid: unknown, decision: unknown, hash: unknown) => assistant.decide(id(aid), oneOf(decision, ['accept', 'decline'] as const, 'decision'), str(hash, 'hash', 64)));

  handle('speech:transcribe', (wav: unknown, lang: unknown) => {
    if (!(wav instanceof Uint8Array) || wav.byteLength > 30 * 1024 * 1024) throw new Error('invalid audio');
    return speech.transcribe(Buffer.from(wav), oneOf(lang, ['auto', 'fr', 'en'] as const, 'lang'));
  });
  handle('speech:synthesize', async (text: unknown, lang: unknown, voice: unknown) => {
    const l = oneOf(lang, ['fr', 'en'] as const, 'lang');
    let v = voice === undefined || voice === null ? (l === 'fr' ? settings.voiceFr : settings.voiceEn) : id(voice, 'voice');
    if (v.startsWith('kokoro-') && !speech.kokoroAvailable) v = speech.voices().find((x) => x.lang === l)?.id ?? v;
    return new Uint8Array(await speech.synthesize(str(text, 'text', 2000), l, v, settings.speechRate, settings.pronunciations));
  });
  handle('speech:voices', () => speech.voices());
  handle('speech:chooseModelsDir', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose the folder with JARVIS speech files (.models)', defaultPath: modelsDir(), properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    db.saveSettings({ modelsDir: r.filePaths[0] });
    db.audit('models-dir-changed', { path: r.filePaths[0] });
    speech = new Speech(modelsDir());
    return speech.health();
  });

  handle('memory:list', () => db.listMemory());
  handle('memory:add', (kind: unknown, text: unknown, source: unknown) => {
    const m = db.addMemory(oneOf(kind, ['preference', 'fact'] as const, 'kind'), str(text, 'text', 2000).trim(), str(source, 'source', 200));
    db.audit('memory-added', { id: m.id });
    return m;
  });
  handle('memory:update', (mid: unknown, kind: unknown, text: unknown) => { db.updateMemory(id(mid), oneOf(kind, ['preference', 'fact'] as const, 'kind'), str(text, 'text', 2000)); db.audit('memory-updated', { id: mid }); });
  handle('memory:delete', (mid: unknown) => { db.deleteMemory(id(mid)); db.audit('memory-deleted', { id: mid }); });

  handle('diag:get', () => diagnostics());
  handle('diag:export', async () => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: `jarvis-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, redact(JSON.stringify({ diagnostics: await diagnostics(), config: effectiveConfig() }, null, 2)), 'utf8');
    return r.filePath;
  });
  handle('app:openExternal', (url: unknown) => {
    const u = new URL(str(url, 'url', 2000));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('only web links can be opened');
    return shell.openExternal(u.toString());
  });
}

function lockDown() {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    const file = normalize(join(DIST, decodeURIComponent(url.pathname)));
    if (url.host !== 'jarvis' || !file.startsWith(DIST + sep)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const ses = session.defaultSession;
  const ours = (origin: string | undefined) => !!origin && origin.startsWith(ORIGIN);
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const ok = ours(details.requestingUrl) && ((permission === 'media' && (details as any).mediaTypes?.every((t: string) => t === 'audio')) || permission === 'speaker-selection' as any);
    if (!ok) log('warn', 'permission denied', { permission, url: details.requestingUrl });
    cb(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => ours(origin) && (permission === 'media' || permission === ('speaker-selection' as any)));
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) e.preventDefault(); });
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-attach-webview', (e) => e.preventDefault());
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 720, minHeight: 520, title: 'JARVIS', backgroundColor: '#0f1115', show: !SELFTEST && settings.uiMode === 'window',
    autoHideMenuBar: true,
    webPreferences: { preload: join(DIST, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true },
  });
  win.on('close', () => { if (!SELFTEST) app.quit(); }); // the island alone must not keep JARVIS running invisibly
  win.on('closed', () => { win = null; });
  void win.loadURL(`${ORIGIN}/index.html`);
}

async function selftest() {
  const results: Record<string, unknown> = {};
  const check = async (name: string, f: () => Promise<unknown>) => {
    const t0 = performance.now();
    try { results[name] = { ok: true, ms: Math.round(performance.now() - t0), value: await f() }; } catch (e) { results[name] = { ok: false, error: (e as Error).message }; }
    (results[name] as any).ms = Math.round(performance.now() - t0);
  };
  await check('renderer', async () => {
    await new Promise<void>((r) => (win!.webContents.isLoading() ? win!.webContents.once('did-finish-load', () => r()) : r()));
    for (let i = 0; i < 50; i++) {
      const ok = await win!.webContents.executeJavaScript(`!!document.querySelector('[data-testid="app-ready"]') && typeof window.jarvis === 'object' && typeof require === 'undefined'`);
      if (ok) return 'mounted; preload API present; no Node in renderer';
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('renderer did not mount');
  });
  await check('island', async () => {
    const w = createIsland();
    await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()));
    for (let i = 0; i < 50; i++) {
      if (await w.webContents.executeJavaScript(`!!document.querySelector('[data-testid="island-ready"] .pill')`)) {
        await new Promise((r) => setTimeout(r, 300));
        writeFileSync(join(app.getPath('userData'), 'selftest-island.png'), (await w.webContents.capturePage()).toPNG());
        const b = w.getBounds();
        w.destroy();
        return `mounted at ${b.width}x${b.height}, always on top; screenshot saved`;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('island did not mount');
  });
  await check('database', async () => ({ schemaVersion: db.schemaVersion, conversations: db.listConversations().length }));
  await check('codex-account', () => codex.account());
  await check('codex-models', async () => (await codex.models()).map((m) => m.id));
  let wav: Buffer | null = null;
  await check('tts-fr', async () => { wav = await speech.synthesize("Bonjour, ceci est un test de JARVIS à 14 h 30.", 'fr', settings.voiceFr, settings.speechRate, settings.pronunciations); return `${wav.length} bytes`; });
  await check('asr-roundtrip', async () => {
    if (!wav) throw new Error('no TTS audio');
    // Piper outputs 22.05 kHz; whisper-cli resamples WAV input itself.
    return speech.transcribe(wav, 'auto');
  });
  if (speech.kokoroAvailable) {
    await check('tts-kokoro-george-roundtrip', async () => {
      const t0 = performance.now();
      const audio = await speech.synthesize('Good evening, sir. Shall I prepare the briefing for Montréal?', 'en', 'kokoro-bm_george', settings.speechRate, settings.pronunciations);
      const synthMs = Math.round(performance.now() - t0);
      return { synthMs, bytes: audio.length, heard: (await speech.transcribe(audio, 'en')).text };
    });
  }
  if (SELFTEST_TURN) {
    await check('chat-turn', async () => {
      const c = db.createConversation('selftest');
      const done = new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('turn timed out')), 120_000);
        const onEv = (ev: ChatEvent) => {
          if (ev.type === 'message' && ev.message.role === 'assistant' && ev.message.status !== 'streaming') { clearTimeout(t); ev.message.status === 'complete' ? resolve(ev.message.text) : reject(new Error(ev.message.text)); }
        };
        listeners.push(onEv);
      });
      assistant.send(c.id, "Réponds seulement: « OK, je t'entends. »");
      const text = await done;
      db.deleteConversation(c.id);
      return text;
    });
    await check('approval-decline', async () => {
      const c = db.createConversation('selftest approval');
      const seen: string[] = [];
      const done = new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('approval flow timed out')), 180_000);
        listeners.push((ev) => {
          if (ev.type === 'approval') {
            seen.push(ev.approval.summary);
            let tamperRejected = false;
            try { assistant.decide(ev.approval.id, 'accept', '0'.repeat(64)); } catch { tamperRejected = true; }
            if (!tamperRejected) return reject(new Error('approval accepted with a wrong payload hash'));
            assistant.decide(ev.approval.id, 'decline', ev.approval.payloadHash);
          }
          if (ev.type === 'message' && ev.message.conversationId === c.id && ev.message.role === 'assistant' && ev.message.status !== 'streaming') { clearTimeout(t); resolve(`${ev.message.status}: ${ev.message.text.slice(0, 200)}`); }
        });
      });
      // A harmless command outside Codex's trusted read-only list, so it must come back as an approval request.
      assistant.send(c.id, 'Run this exact shell command and report its output verbatim: python -c "print(6*7)"');
      const reply = await done;
      db.deleteConversation(c.id);
      if (!seen.length) throw new Error(`no approval request was raised; reply: ${reply}`);
      return { approvalsShown: seen, tamperedHashRejected: true, reply };
    });
  }
  const failed = Object.entries(results).filter(([, v]) => !(v as any).ok).map(([k]) => k);
  const report = JSON.stringify({ ok: failed.length === 0, failed, results }, null, 2);
  writeFileSync(join(app.getPath('userData'), 'selftest.json'), report); // dist is read-only inside the packaged asar
  console.log(report);
  return failed.length === 0;
}

const listeners: ((ev: ChatEvent) => void)[] = [];

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  mkdirSync(workspaceDir(), { recursive: true });
  db = openDb(join(userData, 'jarvis.db'));
  settings = normalizeSettings(db.loadSettings());
  initLog(join(userData, 'logs'), settings.logRetentionDays, settings.logLevel);
  log('info', 'app start', { version: app.getVersion(), electron: process.versions.electron, selftest: SELFTEST });
  codex = new CodexClient();
  speech = new Speech(modelsDir());
  assistant = new Assistant(db, codex, () => settings, workspaceDir(), (ev) => { emit(ev); listeners.forEach((l) => l(ev)); });
  lockDown();
  registerIpc();
  createWindow();
  if (settings.uiMode === 'island' && !SELFTEST) showMode();
  registerGlobalShortcuts();
  codex.ensureStarted().catch((e) => { log('error', 'codex start failed', { message: e.message }); emit({ type: 'state', state: 'offline', detail: friendlyError(e) }); });
  if (SELFTEST) {
    const ok = await selftest();
    codex.stop();
    app.exit(ok ? 0 : 1);
  }
});

app.on('second-instance', () => {
  if (settings.uiMode === 'island') return applySettings({ uiMode: 'window' });
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { globalShortcut.unregisterAll(); codex?.stop(); db?.close(); });
