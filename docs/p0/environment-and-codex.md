# P0 report: environment recheck and Codex app-server proof

Date: 2026-10-23. Scope approved by the user: read-only inspection, repo `D:\Jarvis`, first proof = Codex app-server, no downloads in P0.
Nothing was installed, no settings changed, no credentials created.

## 1. Environment (read-only)

| Item | Observed |
|---|---|
| OS | Windows 11 Home, DisplayVersion 26H2, build 26300.9711 (matches screenshot) |
| CPU / RAM / GPU | Ryzen 5 7600, 31.1 GB visible, Radeon RX 7800 XT (+ iGPU) |
| Free disk | C: 75.2 GB, D: 265.4 GB |
| Toolchain | Node 22.18.0, npm 10.9.3, pnpm 10.28.2, Python 3.11.9, Git 2.52.0, Rust 1.99.0 |
| Codex | npm CLI was 0.125.0 (Apr 2026); updated to 0.164.0 with user approval on 2026-10-23. Codex desktop app 26.1016 bundles `codex-cli 0.163.0-alpha.11.2` (not used) |
| Audio inputs | Microphone (Realtek Audio), Microphone (USBAudio2.0) |
| Audio outputs | Speakers (Realtek), Realtek HD Audio 2nd output, VG27AQ3A and MSI G2422C (monitor audio over AMD HD Audio) |

Audio routing test (2026-10-23): [`tools/p0/audio-routing.html`](../../tools/p0/audio-routing.html), served on `127.0.0.1` and run in Edge, using the Chromium APIs Electron will use (`enumerateDevices`, `getUserMedia` with an exact `deviceId`, `setSinkId`). **User-reported PASS**: independent mic and output selection, live meter, 4 s recording and playback on the chosen output all worked. No log was captured, the unplug step was not separately confirmed, and Bluetooth was not tested.
Run it again: `python -m http.server 8765 --bind 127.0.0.1` in `tools/p0`, then open `http://127.0.0.1:8765/audio-routing.html` in Edge. The Claude app's browser pane cannot run it (it loads the page as `data:`, which has no microphone access).

## 2. Codex app-server proof

Probe: [`tools/p0/codex-probe.mjs`](../../tools/p0/codex-probe.mjs), no dependencies. It spawns `codex app-server --listen stdio://`, runs `initialize` → `account/read` → `account/rateLimits/read` → `model/list` → `thread/start` (read-only sandbox, `approvalPolicy: never`, ephemeral) → one `turn/start`, and declines every server request.

Run it:

```bash
node tools/p0/codex-probe.mjs
```

Result with npm CLI 0.164.0: **PASS** (also passed earlier against the desktop app's bundled 0.163 binary).
- Existing Codex ChatGPT login detected (`type=chatgpt`, `plan=prolite`), rate limits readable (primary 12% used).
- `model/list`: gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna.
- Turn on `gpt-6.1-sol`, effort `low`: status `completed`, French and English lines returned exactly. First delta ~3.5 s after `turn/start` (one sample, not a p50/p95).

Findings along the way (all surfaced as clean `turn/completed status=failed` errors, no secrets in output):
- npm CLI 0.125.0 could not load the user's `~/.codex/config.toml` (`service_tier = "default"` unknown). Fixed by the update.
- ChatGPT plans reject `service_tier: "flex"`; the probe sends `serviceTier: null`.
- With 0.125.0, `model/list` returns an outdated bundled catalog and every model is rejected ("not supported when using Codex with a ChatGPT account"). Only a completed turn proves model access, as the docs warn.

Not yet tested (acceptance matrix "Model access"): expired session recovery, quota exhaustion, offline behaviour, token renewal.

## 2b. Minimal FR/EN speech check (2026-10-23)

Downloads (approved, into gitignored `.models/`, one folder each):

| File | Source | Size | Verification | License |
|---|---|---|---|---|
| whisper-bin-x64.zip | ggml-org/whisper.cpp release b5454 | 8.9 MB | published SHA-256 OK | MIT |
| ggml-small-q5_1.bin | huggingface.co/ggerganov/whisper.cpp | 190 MB | published SHA-256 OK | MIT |
| piper_windows_amd64.zip | rhasspy/piper 2023.11.14-2 (archived) | 22.5 MB | size only (no published hash); sha256 f3c58906…efcea | MIT, bundles espeak-ng (GPL-3) |
| fr_FR-siwis-medium | huggingface.co/rhasspy/piper-voices | 63.2 MB | published SHA-256 OK | CC-BY 4.0 dataset |
| en_GB-cori-medium | huggingface.co/rhasspy/piper-voices | 63.5 MB | published SHA-256 OK | public-domain dataset |
| whisper.cpp source v1.9.5 (commit d1be6fd) | github.com/ggml-org/whisper.cpp | 51 MB | git tag | MIT |

GPU build: whisper.cpp compiled locally with `-DGGML_VULKAN=ON` using the already-installed VS 2022 C++ tools, VS-bundled CMake 3.31 and Vulkan SDK 1.4.363. Runs on `Vulkan0 = AMD Radeon RX 7800 XT`. No prebuilt Vulkan binary is published.

Round trip ([`tools/p0/speech-check.mjs`](../../tools/p0/speech-check.mjs)): Piper speaks 10 FR/EN lines (names, dates, numbers, code-switching), whisper `small` transcribes them back.

| Measure | Result |
|---|---|
| TTS time per sentence | p50 ~0.5 s, p95 ~0.7 s (whole clip, real-time factor ~0.13) |
| ASR per clip, CPU (6 threads) | p50 2.1 s; encoder 1.58 s of it, model load 0.13 s |
| ASR per clip, GPU (Vulkan) | p50 0.49 s per new process; warm single clip 0.35 s, encoder 0.03 s. First run after build ~1.9 s (shader compile, then cached) |
| Round-trip WER | 13–24% FR, 16–24% EN depending on the run; forced language = auto-detect |
| CPU vs GPU transcripts | identical on the same audio |

Error sources: mostly TTS pronunciation of acronyms and borrowed words (French voice: "PDF", "commit"; English voice: "npm", "croissants", once "Schedule"), plus format differences (`14 h 30` → `14h30`, spelled-out amounts → `$1,249.99`). Piper output varies between runs (default noise scale), which moves WER run to run. Whisper also invented text on background noise during the live mic test (e.g. `[MÚSICA]`), so P1 needs push-to-talk or VAD gating and should drop near-silent segments.

Not done: the user's ear verdict on the voices, a scored test of the user's own voice, and whisper as a persistent server (`whisper-server.exe` is built).

## 3. Decision: auth route A (2026-10-23)

Decided by the user: JARVIS uses Codex's own ChatGPT login through app-server (route A), with the npm-global Codex CLI kept up to date.
Revisit before any distribution beyond personal use; route B is the documented path for third-party apps.
Consequences: JARVIS ships no OAuth code and stores no tokens; if `account/read` shows no account, JARVIS tells the user to sign in with the official Codex flow.

Options considered:

| Route | What it is | Trade-offs |
|---|---|---|
| A. Codex's own login (used by the probe) | app-server uses the existing Codex ChatGPT sign-in (`account/login/start` with `chatgpt` documented in the app-server docs) | Works today, zero auth code. Depends on a Codex binary being present; the bundled one lives at a hash-named path that changes on app updates. |
| B. Sign in with ChatGPT for OSS/local apps | JARVIS runs its own OAuth PKCE loopback flow, gets a user-bound `client_id`, passes `ACCESS_TOKEN` to app-server via an `env_key` provider | The route OpenAI documents for third-party local apps. JARVIS must implement sign-in, refresh, restart-and-resume, and a stable `ext_agent_host_id`. Responses limits apply (no hosted tools, `tool_search` fails). |

Neither route grants native audio, image generation or computer use; those stay local tools behind the broker. Route B's eligibility/terms pages ("Request a client ID", "Registration and sign-in") were not read yet.

## 4. Next steps

1. Finish the speech check: user's ear verdict on Siwis/Cori, and a real-voice ASR check (default mic and USB mic).
2. Model-access error paths: expired session, quota exhaustion, offline.
