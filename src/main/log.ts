// Local JSONL logs with secret redaction and day-based retention. Nothing is uploaded.
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWTs
  /\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, // API-key shapes
  /("?(?:access_token|refresh_token|id_token|api_key|password|secret)"?\s*[:=]\s*)"?[^",\s}]+"?/gi,
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((s, re) => s.replace(re, (m, prefix) => (typeof prefix === 'string' && m.startsWith(prefix) ? `${prefix}[REDACTED]` : '[REDACTED]')), text);
}

let dir = '';
let debug = false;
const recent: { ts: number; level: string; msg: string }[] = [];

export function initLog(logDir: string, retentionDays: number, level: 'info' | 'debug') {
  dir = logDir;
  debug = level === 'debug';
  mkdirSync(dir, { recursive: true });
  const cutoff = Date.now() - retentionDays * 86_400_000;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f.endsWith('.log') && statSync(p).mtimeMs < cutoff) unlinkSync(p);
  }
}

export function setLogLevel(level: 'info' | 'debug') { debug = level === 'debug'; }

export function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: unknown) {
  if (level === 'debug' && !debug) return;
  const line = redact(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(data === undefined ? {} : { data }) }));
  if (level !== 'debug') {
    recent.push({ ts: Date.now(), level, msg: redact(msg) });
    if (recent.length > 200) recent.shift();
  }
  if (!dir) return void console.log(line);
  // 'sv' locale formats as YYYY-MM-DD in local time.
  try { appendFileSync(join(dir, `jarvis-${new Date().toLocaleDateString('sv')}.log`), line + '\n'); } catch { /* logging must never crash the app */ }
}

export const recentProblems = () => recent.filter((r) => r.level === 'warn' || r.level === 'error').slice(-30);
export const logDir = () => dir;
