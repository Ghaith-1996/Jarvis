// SQLite storage (Node's built-in node:sqlite) with versioned migrations. Holds no secrets.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { ConversationSummary, MemoryItem, MemoryKind, Message, MessageStatus, Role } from '../shared/contracts.ts';

const MIGRATIONS: string[] = [
  `CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, thread_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     role TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, turn_id TEXT);
   CREATE INDEX messages_conv ON messages(conversation_id, created_at);
   CREATE TABLE memory (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);`,
];

export type Db = ReturnType<typeof openDb>;

export function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version > MIGRATIONS.length) throw new Error(`database schema v${version} is newer than this app (v${MIGRATIONS.length})`);
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  const now = () => Date.now();
  const toMessage = (r: any): Message => ({ id: r.id, conversationId: r.conversation_id, role: r.role, text: r.text, status: r.status, createdAt: r.created_at });
  const toMemory = (r: any): MemoryItem => ({ id: r.id, kind: r.kind, text: r.text, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at });

  return {
    raw: db,
    schemaVersion: MIGRATIONS.length,
    close: () => db.close(),

    createConversation(title = 'New conversation'): ConversationSummary {
      const c = { id: randomUUID(), title, updatedAt: now() };
      db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(c.id, c.title, c.updatedAt, c.updatedAt);
      return c;
    },
    listConversations(query = ''): ConversationSummary[] {
      if (!query.trim()) {
        return (db.prepare('SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 500').all() as any[]).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
      }
      const like = `%${query.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      return (db.prepare(`SELECT c.id, c.title, c.updated_at, (SELECT text FROM messages m WHERE m.conversation_id = c.id AND m.text LIKE ? ESCAPE '\\' LIMIT 1) AS snippet
        FROM conversations c WHERE c.title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.text LIKE ? ESCAPE '\\')
        ORDER BY c.updated_at DESC LIMIT 200`).all(like, like, like) as any[]).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at, snippet: r.snippet ?? undefined }));
    },
    getConversation(id: string) {
      const c = db.prepare('SELECT id, title, thread_id, updated_at FROM conversations WHERE id = ?').get(id) as any;
      if (!c) return null;
      const messages = (db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid').all(id) as any[]).map(toMessage);
      return { id: c.id as string, title: c.title as string, threadId: (c.thread_id ?? null) as string | null, updatedAt: c.updated_at as number, messages };
    },
    setThread(id: string, threadId: string | null) { db.prepare('UPDATE conversations SET thread_id = ? WHERE id = ?').run(threadId, id); },
    renameConversation(id: string, title: string) { db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), id); },
    deleteConversation(id: string) { db.prepare('DELETE FROM conversations WHERE id = ?').run(id); },

    addMessage(conversationId: string, role: Role, text: string, status: MessageStatus): Message {
      const m: Message = { id: randomUUID(), conversationId, role, text, status, createdAt: now() };
      db.prepare('INSERT INTO messages (id, conversation_id, role, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(m.id, conversationId, role, text, status, m.createdAt);
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(m.createdAt, conversationId);
      return m;
    },
    updateMessage(id: string, text: string, status: MessageStatus) { db.prepare('UPDATE messages SET text = ?, status = ? WHERE id = ?').run(text, status, id); },
    setMessageTurn(id: string, turnId: string) { db.prepare('UPDATE messages SET turn_id = ? WHERE id = ?').run(turnId, id); },
    messageTurn(id: string) { return ((db.prepare('SELECT turn_id FROM messages WHERE id = ?').get(id) as any)?.turn_id ?? null) as string | null; },
    /** Delete a message and every later message in its conversation (edit-and-resend). */
    truncateFrom(conversationId: string, messageId: string) {
      const m = db.prepare('SELECT created_at, rowid FROM messages WHERE id = ?').get(messageId) as any;
      if (!m) return;
      db.prepare('DELETE FROM messages WHERE conversation_id = ? AND (created_at > ? OR (created_at = ? AND rowid >= ?))').run(conversationId, m.created_at, m.created_at, m.rowid);
    },

    listMemory(): MemoryItem[] { return (db.prepare('SELECT * FROM memory ORDER BY created_at').all() as any[]).map(toMemory); },
    addMemory(kind: MemoryKind, text: string, source: string): MemoryItem {
      const m = { id: randomUUID(), kind, text, source, createdAt: now(), updatedAt: now() };
      db.prepare('INSERT INTO memory (id, kind, text, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(m.id, kind, text, source, m.createdAt, m.updatedAt);
      return m;
    },
    updateMemory(id: string, kind: MemoryKind, text: string) { db.prepare('UPDATE memory SET kind = ?, text = ?, updated_at = ? WHERE id = ?').run(kind, text, now(), id); },
    deleteMemory(id: string) { db.prepare('DELETE FROM memory WHERE id = ?').run(id); },

    loadSettings(): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      for (const r of db.prepare('SELECT key, value FROM settings').all() as any[]) {
        try { out[r.key] = JSON.parse(r.value); } catch { /* ignore corrupt value; defaults apply */ }
      }
      return out;
    },
    saveSettings(patch: Record<string, unknown>) {
      const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      db.exec('BEGIN');
      try { for (const [k, v] of Object.entries(patch)) stmt.run(k, JSON.stringify(v)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },

    audit(action: string, detail: unknown) { db.prepare('INSERT INTO audit (ts, action, detail) VALUES (?, ?, ?)').run(now(), action, JSON.stringify(detail)); },
    recentAudit(limit = 50) { return (db.prepare('SELECT ts, action, detail FROM audit ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({ ts: r.ts, action: r.action, detail: JSON.parse(r.detail) })); },
  };
}
