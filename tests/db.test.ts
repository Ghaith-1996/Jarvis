import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/main/db.ts';
import { redact } from '../src/main/log.ts';

test('db: migrations, conversations, search, cascade delete, settings, memory', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'jarvis-db-')), 'test.db');
  let db = openDb(path);
  const c = db.createConversation('Rendez-vous dentiste');
  db.addMessage(c.id, 'user', 'Rappelle-moi le 3 mars 100%_sûr', 'complete');
  db.addMessage(c.id, 'assistant', 'OK', 'complete');
  assert.equal(db.listConversations('dentiste').length, 1);
  assert.equal(db.listConversations('100%_').length, 1, 'LIKE wildcards are escaped');
  assert.equal(db.listConversations('10x').length, 0);
  db.saveSettings({ speechRate: 1.25 });
  db.addMemory('preference', 'Prefers metric units', 'user');
  db.close();

  db = openDb(path); // reopen: migrations must be idempotent
  assert.equal(db.getConversation(c.id)?.messages.length, 2);
  assert.equal(db.loadSettings().speechRate, 1.25);
  assert.equal(db.listMemory()[0]?.text, 'Prefers metric units');
  db.deleteConversation(c.id);
  assert.equal((db.raw.prepare('SELECT count(*) n FROM messages').get() as any).n, 0);
  db.close();
});

test('redact removes token shapes', () => {
  const s = redact('Authorization: Bearer abcdefghijklmnop {"access_token":"xyz123"} sk-abcdefghijklmnopqrstu eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def');
  assert.ok(!/abcdefghijklmnop|xyz123|sk-abc|eyJhbGci/.test(s), s);
});
