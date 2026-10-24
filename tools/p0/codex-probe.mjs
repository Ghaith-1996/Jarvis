// P0 compatibility probe: one read-only text turn through the locally installed Codex app-server.
// Usage: node tools/p0/codex-probe.mjs [model]
// Uses the existing Codex ChatGPT login; creates no credentials, grants no tools (read-only sandbox, approvals declined).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// shortcut: hardcoded npm-global path, resolve from PATH when this becomes the real provider adapter.
const codexJs = join(process.env.APPDATA ?? '', 'npm/node_modules/@openai/codex/bin/codex.js');
if (!existsSync(codexJs)) throw new Error(`Codex CLI not found at ${codexJs}`);

// In-memory override only: never trigger the user's notify hook from a probe.
const args = [codexJs, '-c', 'notify=[]', 'app-server', '--listen', 'stdio://'];
const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;
const stderr = [];
child.stderr.on('data', (b) => stderr.push(b.toString()));

let nextId = 1;
const pending = new Map();
const listeners = [];
const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    send({ id, method, params });
  });

let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { console.log('[non-json]', line.slice(0, 200)); continue; }
    if (msg.id !== undefined && pending.has(msg.id) && !msg.method) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(Object.assign(new Error(`${p.method}: ${msg.error.message}`), { rpc: msg.error })) : p.resolve(msg.result);
    } else if (msg.id !== undefined && msg.method) {
      // Server-initiated request (approval, tool call, user input): this probe grants nothing.
      console.log(`[${ms()}] server request ${msg.method} -> declined`);
      send({ id: msg.id, error: { code: -32601, message: 'jarvis p0 probe grants no approvals or tools' } });
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg));
    }
  }
});

const timeout = setTimeout(() => fail(new Error('timed out after 120s')), 120_000);
function finish(code) {
  clearTimeout(timeout);
  child.kill();
  process.exit(code);
}
function fail(err) {
  console.error(`FAIL [${ms()}]: ${err.message}`);
  if (err.rpc) console.error('rpc error:', JSON.stringify(err.rpc).slice(0, 500));
  const tail = stderr.join('').trim();
  if (tail) console.error('stderr tail:', tail.slice(-800));
  finish(1);
}
child.on('exit', (code) => { if (pending.size) fail(new Error(`app-server exited (${code}) with pending requests`)); });

try {
  const init = await request('initialize', { clientInfo: { name: 'jarvis_p0_probe', title: 'JARVIS P0 probe', version: '0.0.1' } });
  send({ method: 'initialized' });
  console.log(`[${ms()}] initialize ok`, init?.userAgent ?? '');

  const acct = await request('account/read', {});
  // Print only non-identifying fields; never log email or tokens.
  console.log(`[${ms()}] account: type=${acct?.account?.type ?? 'none'} plan=${acct?.account?.planType ?? '?'} requiresOpenaiAuth=${acct?.requiresOpenaiAuth}`);
  if (!acct?.account) throw new Error('not signed in; run the official Codex sign-in yourself, then retry');

  try {
    const rl = await request('account/rateLimits/read', {});
    const p = rl?.rateLimits?.primary, s = rl?.rateLimits?.secondary;
    console.log(`[${ms()}] rate limits: primary ${p?.usedPercent ?? '?'}% used, secondary ${s?.usedPercent ?? '?'}% used`);
  } catch (e) { console.log(`[${ms()}] rate limits unavailable: ${e.message}`); }

  const models = (await request('model/list', {}))?.data ?? [];
  console.log(`[${ms()}] model/list (${models.length}): ${models.map((m) => m.id ?? m.model).join(', ')}`);
  const model = process.argv[2] ?? (models.find((m) => m.isDefault) ?? models[0])?.id ?? (models[0]?.model);
  if (!model) throw new Error('model/list returned no models');

  const cwd = mkdtempSync(join(tmpdir(), 'jarvis-p0-'));
  const thread = await request('thread/start', { model, cwd, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true, serviceTier: null });
  const threadId = thread?.thread?.id;
  console.log(`[${ms()}] thread/start ok model=${model}`);

  let text = '';
  let firstDelta;
  const done = new Promise((resolve) => listeners.push((msg) => {
    if (msg.method === 'item/agentMessage/delta') { firstDelta ??= ms(); text += msg.params?.delta ?? ''; }
    if (msg.method === 'turn/completed') resolve(msg.params?.turn);
    if (msg.method === 'error') console.log(`[${ms()}] error notification:`, JSON.stringify(msg.params).slice(0, 300));
  }));
  const turnStart = Date.now();
  await request('turn/start', {
    threadId,
    effort: 'low',
    serviceTier: null, // explicit null = standard tier; ChatGPT plans reject "flex"
    input: [{ type: 'text', text: "Réponds exactement par la ligne « OK, je t'entends. » puis la ligne \"OK, I hear you.\" Rien d'autre." }],
  });
  const turn = await done;
  console.log(`[${ms()}] first delta at ${firstDelta ?? 'never'}, turn took ${Date.now() - turnStart}ms`);
  console.log(`[${ms()}] turn status=${turn?.status}${turn?.error ? ' error=' + JSON.stringify(turn.error).slice(0, 300) : ''}`);
  console.log('--- assistant text ---\n' + text.trim() + '\n----------------------');
  if (turn?.status !== 'completed') throw new Error(`turn ended with status ${turn?.status}`);
  console.log('PASS');
  finish(0);
} catch (e) {
  fail(e);
}
