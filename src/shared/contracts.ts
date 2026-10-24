// Types and validators shared by main, preload and renderer. Main validates every IPC payload with these;
// the renderer is treated as untrusted.

export type Lang = 'fr' | 'en';
export type SpeechLang = 'auto' | Lang;
export type Effort = 'low' | 'medium' | 'high';

export type Pronunciation = { lang: Lang; from: string; to: string };
// pushToTalk/stop/newConversation work inside the focused window; islandPushToTalk and toggleIsland are system-wide.
export type Hotkeys = { pushToTalk: string; stop: string; newConversation: string; islandPushToTalk: string; toggleIsland: string };

export type Settings = {
  speechLanguage: SpeechLang;
  frLocale: 'fr-FR' | 'fr-CA';
  inputDeviceId: string | null; // null = not chosen yet; 'default' = follow Windows default explicitly
  inputDeviceLabel: string | null;
  outputDeviceId: string | null;
  outputDeviceLabel: string | null;
  outputVolume: number;
  muted: boolean;
  readAloud: 'voice' | 'always' | 'never'; // when to speak replies automatically
  voiceFr: string;
  voiceEn: string;
  speechRate: number;
  pronunciations: Pronunciation[];
  model: string | null; // null = account default
  effort: Effort;
  hotkeys: Hotkeys;
  uiMode: 'window' | 'island';
  fontScale: number;
  highContrast: boolean;
  reducedMotion: 'system' | 'on' | 'off';
  startAtLogin: boolean;
  logLevel: 'info' | 'debug';
  logRetentionDays: number;
  approvalTimeoutSec: number;
};

export const defaultSettings: Settings = {
  speechLanguage: 'auto',
  frLocale: 'fr-FR',
  inputDeviceId: null,
  inputDeviceLabel: null,
  outputDeviceId: null,
  outputDeviceLabel: null,
  outputVolume: 1,
  muted: false,
  readAloud: 'voice',
  voiceFr: 'fr_FR-siwis-medium',
  voiceEn: 'kokoro-bm_george', // falls back to a Piper voice if Kokoro files are missing
  speechRate: 1,
  pronunciations: [
    { lang: 'fr', from: 'PDF', to: 'pé dé èf' },
    { lang: 'en', from: 'npm', to: 'N P M' },
  ],
  model: null,
  effort: 'low',
  hotkeys: { pushToTalk: 'F2', stop: 'Escape', newConversation: 'Ctrl+N', islandPushToTalk: 'Ctrl+Shift+Space', toggleIsland: 'Ctrl+Alt+J' },
  uiMode: 'window',
  fontScale: 1,
  highContrast: false,
  reducedMotion: 'system',
  startAtLogin: false,
  logLevel: 'info',
  logRetentionDays: 14,
  approvalTimeoutSec: 300,
};

export type Role = 'user' | 'assistant' | 'system';
export type MessageStatus = 'complete' | 'streaming' | 'queued' | 'interrupted' | 'failed';
export type Message = { id: string; conversationId: string; role: Role; text: string; status: MessageStatus; createdAt: number };
export type ConversationSummary = { id: string; title: string; updatedAt: number; snippet?: string };

export type MemoryKind = 'preference' | 'fact';
export type MemoryItem = { id: string; kind: MemoryKind; text: string; source: string; createdAt: number; updatedAt: number };

export type AssistantState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'awaiting-approval' | 'executing' | 'speaking' | 'paused' | 'offline' | 'failed';

export type Approval = {
  id: string;
  conversationId: string | null;
  kind: 'command' | 'file-change';
  summary: string; // exact command or file-change description, shown verbatim
  cwd: string | null;
  reason: string | null;
  payloadHash: string;
  expiresAt: number;
};

export type ChatEvent =
  | { type: 'message'; message: Message }
  | { type: 'delta'; conversationId: string; messageId: string; delta: string }
  | { type: 'state'; state: AssistantState; detail?: string }
  | { type: 'approval'; approval: Approval }
  | { type: 'approval-resolved'; id: string; decision: 'accept' | 'decline' | 'expired' }
  | { type: 'conversations-changed' }
  | { type: 'ui-mode'; mode: 'window' | 'island'; conversationId: string | null }
  | { type: 'hotkey'; action: 'island-ptt' };

export type Voice = { id: string; lang: Lang; label: string };
export type TranscribeResult = { text: string; language: Lang | null; ms: number };

// --- validation helpers (throw on bad input) ---

export class InvalidInput extends Error {}
const fail = (what: string): never => { throw new InvalidInput(`invalid ${what}`); };

export const str = (v: unknown, what: string, max = 100_000): string =>
  typeof v === 'string' && v.length <= max ? v : fail(what);
export const id = (v: unknown, what = 'id'): string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : fail(what);
export const oneOf = <T extends string>(v: unknown, opts: readonly T[], what: string): T =>
  opts.includes(v as T) ? (v as T) : fail(what);
export const num = (v: unknown, min: number, max: number, what: string): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(what);
export const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : fail(what));
const nullableStr = (v: unknown, what: string) => (v === null ? null : str(v, what, 500));
const hotkey = (v: unknown, what: string) => (typeof v === 'string' && /^[A-Za-z0-9+ ]{1,32}$/.test(v) ? v : fail(what));

const settingValidators: { [K in keyof Settings]: (v: unknown) => Settings[K] } = {
  speechLanguage: (v) => oneOf(v, ['auto', 'fr', 'en'] as const, 'speechLanguage'),
  frLocale: (v) => oneOf(v, ['fr-FR', 'fr-CA'] as const, 'frLocale'),
  inputDeviceId: (v) => nullableStr(v, 'inputDeviceId'),
  inputDeviceLabel: (v) => nullableStr(v, 'inputDeviceLabel'),
  outputDeviceId: (v) => nullableStr(v, 'outputDeviceId'),
  outputDeviceLabel: (v) => nullableStr(v, 'outputDeviceLabel'),
  outputVolume: (v) => num(v, 0, 1, 'outputVolume'),
  muted: (v) => bool(v, 'muted'),
  readAloud: (v) => oneOf(v, ['voice', 'always', 'never'] as const, 'readAloud'),
  voiceFr: (v) => id(v, 'voiceFr'),
  voiceEn: (v) => id(v, 'voiceEn'),
  speechRate: (v) => num(v, 0.5, 2, 'speechRate'),
  pronunciations: (v) => {
    if (!Array.isArray(v) || v.length > 200) return fail('pronunciations');
    return v.map((p) => ({ lang: oneOf(p?.lang, ['fr', 'en'] as const, 'pronunciation.lang'), from: str(p?.from, 'pronunciation.from', 100), to: str(p?.to, 'pronunciation.to', 200) }));
  },
  model: (v) => (v === null ? null : typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : fail('model')),
  effort: (v) => oneOf(v, ['low', 'medium', 'high'] as const, 'effort'),
  hotkeys: (v) => {
    if (!v || typeof v !== 'object') return fail('hotkeys');
    const h = { ...defaultSettings.hotkeys, ...(v as Record<string, unknown>) }; // keys added in later versions get defaults
    const out = {} as Hotkeys;
    for (const k of Object.keys(defaultSettings.hotkeys) as (keyof Hotkeys)[]) out[k] = hotkey(h[k], `hotkeys.${k}`);
    return out;
  },
  uiMode: (v) => oneOf(v, ['window', 'island'] as const, 'uiMode'),
  fontScale: (v) => num(v, 0.8, 1.6, 'fontScale'),
  highContrast: (v) => bool(v, 'highContrast'),
  reducedMotion: (v) => oneOf(v, ['system', 'on', 'off'] as const, 'reducedMotion'),
  startAtLogin: (v) => bool(v, 'startAtLogin'),
  logLevel: (v) => oneOf(v, ['info', 'debug'] as const, 'logLevel'),
  logRetentionDays: (v) => num(v, 1, 365, 'logRetentionDays'),
  approvalTimeoutSec: (v) => num(v, 30, 3600, 'approvalTimeoutSec'),
};

export function validateSettingsPatch(patch: unknown): Partial<Settings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return fail('settings patch');
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const check = settingValidators[k as keyof Settings];
    if (!check) fail(`setting ${k}`);
    out[k] = check(v);
  }
  return out as Partial<Settings>;
}

/** Merge stored settings over defaults, dropping anything that no longer validates (e.g. after an upgrade). */
export function normalizeSettings(stored: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = { ...defaultSettings };
  for (const [k, v] of Object.entries(stored)) {
    const check = settingValidators[k as keyof Settings];
    if (!check) continue;
    try { out[k] = check(v); } catch { /* keep default */ }
  }
  return out as Settings;
}
