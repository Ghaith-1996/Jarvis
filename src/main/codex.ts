// Codex app-server client over stdio (JSON-RPC, newline-delimited). Auth is Codex's own ChatGPT login (ADR: route A).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { log } from './log.ts';

// shortcut: fixed npm-global layout of @openai/codex 0.164 on Windows x64; make configurable if Codex moves or ships elsewhere.
const PKG = join(process.env.APPDATA ?? '', 'npm/node_modules/@openai/codex');
export const CODEX_EXE = join(PKG, 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');

export type Notification = { method: string; params: any };
export type ServerRequest = { id: number | string; method: string; params: any };
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; method: string; timer: NodeJS.Timeout };

export class RpcError extends Error {
  constructor(message: string, readonly rpc: unknown) { super(message); }
}

/**
 * Events: 'notification' (Notification), 'server-request' (ServerRequest), 'exit' (code).
 * The owner must answer every server request via respond()/respondError().
 */
export class CodexClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buf = '';
  stderrTail = '';
  userAgent = '';

  get running() { return this.child !== null; }

  ensureStarted(): Promise<void> {
    if (this.child) return Promise.resolve();
    this.starting ??= this.start().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async start() {
    if (!existsSync(CODEX_EXE)) throw new Error(`Codex CLI not found at ${CODEX_EXE}. Install it with: npm install -g @openai/codex`);
    // In-memory override only: never trigger the user's Codex notify hook from JARVIS.
    const child = spawn(CODEX_EXE, ['-c', 'notify=[]', 'app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: PKG },
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    child.stderr.on('data', (b: Buffer) => { this.stderrTail = (this.stderrTail + b.toString()).slice(-4000); });
    child.on('exit', (code) => {
      log('warn', 'codex app-server exited', { code });
      this.child = null;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`Codex app-server exited (${code}) during ${p.method}`)); }
      this.pending.clear();
      this.emit('exit', code);
    });
    child.on('error', (e) => log('error', 'codex spawn error', { message: e.message }));
    const init = await this.request('initialize', { clientInfo: { name: 'jarvis', title: 'JARVIS', version: '0.1.0' } }, 30_000);
    this.send({ method: 'initialized' });
    this.userAgent = init?.userAgent ?? '';
    log('info', 'codex app-server ready', { userAgent: this.userAgent });
  }

  stop() { this.child?.kill(); }

  private send(msg: unknown) { this.child?.stdin.write(JSON.stringify(msg) + '\n'); }

  request<T = any>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
    if (!this.child) return Promise.reject(new Error('Codex app-server is not running'));
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.send({ id, method, params });
    });
  }

  respond(id: number | string, result: unknown) { this.send({ id, result }); }
  respondError(id: number | string, message: string) { this.send({ id, error: { code: -32000, message } }); }

  private onData(chunk: string) {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { log('warn', 'codex non-JSON output', { line: line.slice(0, 200) }); continue; }
      if (msg.id !== undefined && !msg.method) {
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        msg.error ? p.reject(new RpcError(`${p.method}: ${msg.error.message}`, msg.error)) : p.resolve(msg.result);
      } else if (msg.id !== undefined && msg.method) {
        this.emit('server-request', { id: msg.id, method: msg.method, params: msg.params } satisfies ServerRequest);
      } else if (msg.method) {
        this.emit('notification', { method: msg.method, params: msg.params } satisfies Notification);
      }
    }
  }

  // --- typed helpers for the methods JARVIS uses ---

  async account() {
    await this.ensureStarted();
    const r = await this.request('account/read', {});
    return { type: (r?.account?.type ?? null) as string | null, plan: (r?.account?.planType ?? null) as string | null };
  }

  async rateLimits() {
    await this.ensureStarted();
    const r = await this.request('account/rateLimits/read', {});
    return { primaryUsedPercent: r?.rateLimits?.primary?.usedPercent ?? null, secondaryUsedPercent: r?.rateLimits?.secondary?.usedPercent ?? null, raw: r?.rateLimits ?? null };
  }

  async models(): Promise<{ id: string; isDefault: boolean }[]> {
    await this.ensureStarted();
    const r = await this.request('model/list', {});
    return (r?.data ?? []).map((m: any) => ({ id: m.id ?? m.model, isDefault: !!m.isDefault }));
  }

  async startThread(opts: { model: string | null; cwd: string; developerInstructions: string }): Promise<string> {
    await this.ensureStarted();
    const r = await this.request('thread/start', {
      ...(opts.model ? { model: opts.model } : {}),
      cwd: opts.cwd,
      sandbox: 'read-only',
      approvalPolicy: 'untrusted', // anything beyond trusted read-only commands comes back to us as an approval request
      approvalsReviewer: 'user', // never let a subagent approve on the user's behalf
      serviceTier: null, // ChatGPT plans reject "flex"
      ephemeral: false,
      developerInstructions: opts.developerInstructions,
    });
    return r.thread.id;
  }

  async resumeThread(threadId: string) {
    await this.ensureStarted();
    await this.request('thread/resume', { threadId, approvalsReviewer: 'user' });
  }

  async startTurn(threadId: string, text: string, effort: string): Promise<string> {
    const r = await this.request('turn/start', { threadId, effort, serviceTier: null, input: [{ type: 'text', text }] });
    return r?.turn?.id;
  }

  interrupt(threadId: string, turnId: string) { return this.request('turn/interrupt', { threadId, turnId }); }
  /** Drop `turnId` and everything after it from the thread's history (used to edit a sent prompt). */
  revert(threadId: string, beforeTurnId: string) { return this.request('thread/revert', { threadId, beforeTurnId }); }
}
