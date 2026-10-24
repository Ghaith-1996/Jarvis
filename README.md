# JARVIS

A personal French/English desktop assistant for Windows. Text and push-to-talk voice chat through your ChatGPT plan (via the official Codex app-server), with speech recognition and voices running locally on your PC. It asks before running anything, never falls back to a paid API, and keeps no recordings.

Status (2026-10-23): **P0 (compatibility proof) and P1 (safe conversational desktop) are done**, plus an island mode and British male voices added after the first hands-on test. P2–P4 are not started.

## How to run

### Requirements

- Windows 11, Node.js 22+, Git.
- Codex CLI, signed in with ChatGPT:
  ```bash
  npm install -g @openai/codex
  ```
  then run `codex login` once. JARVIS uses that login; it stores no tokens itself.
- Speech files in `.models/` (gitignored, about 900 MB). Each goes in its own folder:

  | Folder | What | Source | License |
  |---|---|---|---|
  | `whisper-model/ggml-small-q5_1.bin` | Speech-to-text model | huggingface.co/ggerganov/whisper.cpp | MIT |
  | `whisper-bin/x/` | whisper.cpp CPU build (fallback), unzip `whisper-bin-x64.zip` | github.com/ggml-org/whisper.cpp release b5454 | MIT |
  | `whisper-vulkan/` | whisper.cpp GPU build, see below | built locally from v1.9.5 | MIT |
  | `piper-bin/x/piper/` | Piper voice engine, unzip `piper_windows_amd64.zip` | github.com/rhasspy/piper 2023.11.14-2 | MIT (bundles GPL-3 espeak-ng) |
  | `voice-fr/fr_FR-siwis-medium.onnx` (+ `.json`) | French voice | huggingface.co/rhasspy/piper-voices | CC-BY 4.0 |
  | `voice-en/en_GB-cori-medium.onnx` (+ `.json`) | English fallback voice | huggingface.co/rhasspy/piper-voices | public domain |
  | `sherpa-bin/` | sherpa-onnx v2.0.0 runtime, extract `sherpa-onnx-v2.0.0-win-x64-static-MD-Release.tar.bz2` | github.com/k2-fsa/sherpa-onnx | Apache-2.0 |
  | `voice-kokoro/` | Kokoro v1.0 voices, extract `kokoro-int8-multi-lang-v1_0.tar.bz2` | github.com/k2-fsa/sherpa-onnx `tts-models` release | Apache-2.0 |

  Exact versions, sizes and SHA-256 hashes are in [docs/p0/environment-and-codex.md](docs/p0/environment-and-codex.md) §2b and [docs/p1/handover.md](docs/p1/handover.md).

- GPU speech-to-text (optional; the CPU build works, about 4× slower): with Visual Studio 2022 C++ tools and the Vulkan SDK installed, clone the source, then run the build script:
  ```bash
  git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp .models/whisper-src
  ```
  ```bash
  scripts\build-whisper-vulkan.bat
  ```

### Start

```bash
npm install
```
```bash
npm start
```

On first launch, go to **Settings → Devices** and choose your microphone and speaker; text chat works without them.

### Package a standalone exe

```bash
npm run package
```

Output: `out\JARVIS-win32-x64\JARVIS.exe` (unsigned). It looks for a `models` folder next to the exe, then for the repo's `.models`; otherwise choose the folder in Settings → Language and voice → Speech files.

### Checks

```bash
npm run typecheck
```
```bash
npm test
```
```bash
npx electron . --selftest
```

Add `--selftest-turn` for two live Codex turns (uses a little ChatGPT quota). Results go to `%APPDATA%\jarvis\selftest.json`.

### Using it

| Action | Default |
|---|---|
| Push to talk (full window, hold) | `F2` |
| Stop speaking / interrupt / cancel recording | `Esc` |
| New conversation | `Ctrl+N` |
| Switch between full window and island (any app) | `Ctrl+Alt+J` |
| Push to talk in island mode (any app; press, then press again) | `Ctrl+Shift+Space` |

All shortcuts can be changed in Settings. After you talk, the transcript appears for correction before it is sent.

## What was done

**P0, compatibility proof** ([report](docs/p0/environment-and-codex.md))
- Environment checked (Windows 11 26H2 build 26300.9711, Ryzen 5 7600, RX 7800 XT).
- Codex app-server proven: a French/English turn through the existing ChatGPT login. Decision: use Codex's own login (route A); revisit before any distribution.
- Audio routing proven: separate mic and output selection with playback on the chosen device.
- Speech check: whisper `small` speech-to-text built for the GPU with Vulkan (about 0.35–0.6 s per sentence vs 2.1 s on CPU, same transcripts) and Piper voices (about 0.5 s per sentence).

**P1, safe conversational desktop** ([handover](docs/p1/handover.md))
- Electron + React + TypeScript app with a locked-down renderer (sandbox, no Node, strict CSP, custom `app://` origin, validated IPC allowlist).
- Chat: streaming FR/EN replies, Stop, queued sends, editing a sent prompt, auto titles, search, Markdown export.
- Voice: push-to-talk, timer, cancel, transcript preview, GPU speech-to-text, replies spoken sentence by sentence as they stream, "Speak selection".
- Devices: separate saved mic and output, live meter, record/playback test, volume, mute; never switches devices on its own and asks when a device returns with a new ID.
- Voices: Kokoro British male voices (George by default; Daniel, Lewis, Fable) for English, Piper Siwis for French, speed, pronunciation rules, fr-FR/fr-CA spelling.
- Safety: Codex runs read-only; anything else shows an approval card with the exact command, bound to a hash of the request, single-use, expiring after 5 minutes. Approvals always go to the user.
- Island mode: a compact always-on-top pill that expands for transcripts, replies and approvals.
- Memory page with "Remember this", Settings with the effective configuration, Diagnostics with redacted export, local redacted logs and an audit trail, accessibility basics (keyboard, labels, high contrast, text size, reduced motion, text state).
- Packaged `JARVIS.exe`. Self-test covers the UI, island, database, Codex, speech round trips, a live turn and an approval decline; 11 unit tests.

Every spec feature ID and its status is tracked in [docs/acceptance/traceability.md](docs/acceptance/traceability.md).

## What's left

**Open items from P1**
- Hands-on checks not yet done: a screen-reader pass, interrupting and editing against live Codex, unplugging devices during use.
- Kokoro is slow on CPU (about 2–4 s before speech starts, possible pauses between sentences). Keeping the model loaded with sherpa's Node add-on would cut about 1.3 s per sentence (new package, needs approval).
- Kokoro gets ASCII-only text (accents dropped in English) because of a Windows command-line limit; the Node add-on would also fix this.
- Interface text is English only (conversation and speech are FR/EN).
- Untested Codex error paths: expired login, usage limit, offline.
- Only command and file-change approvals are supported; other Codex requests are declined and logged.

**Undecided scope cuts** (proposed, not yet answered): hand coding work (D01–D05) to the Codex app instead of rebuilding it, drop VoiceStudio, park P4 and account connectors.

**P2, useful local assistant**: file, document (DOCX/PDF/XLSX/PPTX), browser-research and window tools behind the approval broker; voice activity detection and hands-free sessions; dictation into other apps; screen explanation on request.

**P3, durable assistance**: email/calendar/tasks connectors, long-term memory with sources, scheduled jobs and monitoring, crash recovery, encrypted backup and restore.

**P4, optional modules**: phone companion, smart home, wake word, plugin SDK, generative media, signed updates and installer.

## Project layout

```
src/main/       Electron main: window and security (index.ts), Codex client, turns and approvals, speech, SQLite, logs
src/preload/    The fixed list of calls the UI may make
src/renderer/   React UI: full window (App.tsx), island (Island.tsx), shared controller (useAssistant.ts), audio
src/shared/     Types, IPC validators, text helpers
tests/          Unit tests (node --test)
scripts/        Build, package and whisper Vulkan build scripts
tools/p0/       P0 probes: Codex app-server, audio routing page, speech check
docs/           P0 report, P1 handover, feature traceability
```

Personal use. Model and voice licenses differ (see the table above); review them before any redistribution.
