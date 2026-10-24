import type { Approval, AssistantState, ChatEvent, ConversationSummary, Lang, MemoryItem, MemoryKind, Message, Settings, SpeechLang, TranscribeResult, Voice } from '../shared/contracts.ts';

type Conversation = { id: string; title: string; threadId: string | null; updatedAt: number; messages: Message[] };

// Typed view of what preload exposes (window.jarvis). Kept as an explicit interface so the renderer never sees Node types.
export interface JarvisApi {
  settings: { get(): Promise<Settings>; set(patch: Partial<Settings>): Promise<Settings>; effective(): Promise<unknown> };
  state(): Promise<{ state: AssistantState; approvals: Approval[] }>;
  ui: {
    get(): Promise<{ mode: 'window' | 'island'; conversationId: string | null }>;
    setMode(mode: 'window' | 'island', conversationId: string | null): Promise<void>;
    setConversation(conversationId: string | null): Promise<void>;
    resizeIsland(height: number): Promise<void>;
  };
  conv: { list(q?: string): Promise<ConversationSummary[]>; get(id: string): Promise<Conversation | null>; create(): Promise<ConversationSummary>; remove(id: string): Promise<void>; exportMd(id: string): Promise<string | null> };
  chat: { send(convId: string, text: string): Promise<void>; edit(convId: string, msgId: string, text: string): Promise<void>; interrupt(): Promise<void> };
  approval: { decide(id: string, decision: 'accept' | 'decline', hash: string): Promise<void> };
  speech: { transcribe(wav: Uint8Array, lang: SpeechLang): Promise<TranscribeResult>; synthesize(text: string, lang: Lang, voice?: string | null): Promise<Uint8Array>; voices(): Promise<Voice[]>; chooseModelsDir(): Promise<{ modelsDir: string; whisperBackend: string; piper: boolean; voices: string[] } | null> };
  memory: { list(): Promise<MemoryItem[]>; add(kind: MemoryKind, text: string, source: string): Promise<MemoryItem>; update(id: string, kind: MemoryKind, text: string): Promise<void>; remove(id: string): Promise<void> };
  diag: { get(): Promise<any>; exportJson(): Promise<string | null> };
  openExternal(url: string): Promise<void>;
  onEvent(fn: (ev: ChatEvent) => void): () => void;
}

declare global { interface Window { jarvis: JarvisApi } }
export const api = window.jarvis;
export type { Conversation };

/** Strip Electron's "Error invoking remote method 'x': Error: " prefix for display. */
export const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
