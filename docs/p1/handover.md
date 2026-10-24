# P1 handover: safe conversational desktop

Date: 2026-10-23. Status: development build (`npm start`) and packaged build (`out/JARVIS-win32-x64/JARVIS.exe`) both pass the self-test; hands-on test results pending.

## Packaged build

```bash
npm run package
```

Output: `out\JARVIS-win32-x64\JARVIS.exe` (~370 MB, mostly the Electron runtime; app code is a 0.3 MB asar with only `dist/` and `package.json`). Built with `@electron/packager` 20.3.0 (BSD-2-Clause), unsigned. Speech files are not bundled. The exe looks for a `models` folder next to it, then for the repo's `.models` when it still sits in `outJARVIS-win32-x64`; otherwise choose the folder in Settings → Language and voice → Speech files. The dev and packaged builds share `%APPDATA%\jarvis` (same settings, conversations and single-instance lock), so close one before opening the other.

## Run it

```bash
npm install
npm start
```

Prerequisites already on this PC: Node 22, the npm Codex CLI 0.164 signed in with ChatGPT, and the speech files in `.models/` (see [P0 report](../p0/environment-and-codex.md) §2b). Override the models folder with `JARVIS_MODELS_DIR`.

Checks:

```bash
npm run typecheck
npm test
npx electron . --selftest
```

`--selftest-turn` adds two live Codex turns (uses a little ChatGPT quota). Results are written to `dist/selftest.json`.

## Evidence (2026-10-23)

| Check | Result |
|---|---|
| `tsc --noEmit` (strict) | clean |
| Unit tests (`npm test`) | 10 pass: settings validation, text helpers, SQLite migrations/search/cascade, log redaction, WAV encoding, device-switch rules, hotkeys |
| Self-test: renderer | mounted, preload API present, `require` undefined in the renderer |
| Self-test: Codex | account `chatgpt`/`prolite`, 7 models listed, FR turn completed in ~4 s |
| Self-test: speech | Piper FR 0.53 s, whisper Vulkan round trip 0.56 s, language detected `fr` |
| Self-test: approvals | Command outside Codex's trusted list raised an approval card with the exact command; a wrong payload hash was rejected; decline was honored and reported |
| Packaged exe self-test (incl. live turn and approval decline) | all 8 checks pass |
| Hands-on UI test | pending (user) |

## Architecture as built

Single package instead of the spec's suggested monorepo (one app, no second consumer yet):

- `src/main/`: window and security policy (`index.ts`), Codex app-server client (`codex.ts`), turn orchestration and approvals (`assistant.ts`), local speech (`speech.ts`), SQLite storage (`db.ts`), redacted logs (`log.ts`).
- `src/preload/`: fixed list of named calls (no generic invoke).
- `src/renderer/`: React UI; audio capture/playback in `audio.ts`.
- `src/shared/`: types, IPC validators, text helpers.

Trust boundaries: renderer has `contextIsolation`, `sandbox`, no Node, strict CSP, served from a custom `app://` origin; every IPC handler checks the sender origin and validates arguments; permissions are limited to microphone and speaker selection for our origin; navigation and new windows are blocked (web links open in the default browser).

## Capability matrix

| ID | Feature | State |
|---|---|---|
| C01 | FR/EN text chat, streaming, auto titles, search, Markdown export, new conversation, edit a sent prompt (Codex `thread/revert`) | implemented; edit path not yet run live |
| C02 | Push-to-talk (hold F2 or click), recording timer, cancel (Esc), transcript preview with correction, text-only use | implemented; needs hands-on test |
| C03 | Separate saved mic/output, explicit "System default", live meter, 3 s record-and-playback test, volume, mute, refresh, unplug detection, "same name, new ID" confirmation, no silent switching | implemented; unplug paths need hands-on test |
| C04 | Local whisper ASR (GPU) and Piper TTS, auto/FR/EN override, per-language voice choice and preview, speed, pronunciation rules, speak selection, fr-FR/fr-CA spelling | implemented |
| C05 | Stop speaking, interrupt turn, queued sends, mic never open while speaking (talking stops playback first) | implemented; interrupt not yet run live |
| M01 | Conversation continuity (Codex threads resumed), "Remember this", editable memory page | implemented |
| O01 | Keyboard use, labels, skip link, live regions, focus on approval cards, high contrast, reduced motion, text size, captions (all speech is shown as text), state shown as text + icon, configurable hotkeys | implemented; screen-reader pass not done |
| O02 | Settings for language, devices, privacy, approvals, logging, startup; effective configuration view | implemented ("budgets" = usage shown, paid fallback disabled) |
| O03 | Local redacted JSONL logs with retention, audit table, diagnostics page and redacted export, no telemetry | implemented (P1 part) |
| P1 packaging | Packaged development build | verified by self-test; unsigned, no installer |

## Island mode (added after the first hands-on test)

A compact always-on-top pill (460 px wide, top centre of the primary screen) that shows state, talk/stop and expand buttons, and grows to show the transcript preview, the streaming reply, approval cards (same exact-action card as the full window) and a one-line text box.

- Switch: "⇱ Island" in the full window, "⤢" on the island, or `Ctrl+Alt+J` from any app.
- Talk in island mode: `Ctrl+Shift+Space` from any app, press to start and press again to stop (Windows global shortcuts cannot detect key release). It is only registered while the island is shown, so it never blocks other apps otherwise. F2 is not used globally because it is Explorer's rename key.
- Only the visible view records and speaks, so replies are never spoken twice; switching views stops audio in the one being hidden.
- Closing the full window quits JARVIS (the island never keeps it running invisibly). The mode is remembered across restarts.
- Self-test mounts the island and saves a screenshot to `%APPDATA%\jarvis\selftest-island.png`.

## Kokoro voices (added after the first hands-on test)

The first test found the Piper voice not "JARVIS-like" enough. JARVIS does not imitate or clone the film actor's voice; instead it adds Kokoro v1.0 (Apache-2.0) British male voices through sherpa-onnx v2.0.0 (Apache-2.0), both verified by published SHA-256:

| File | Size | Folder |
|---|---|---|
| sherpa-onnx-v2.0.0-win-x64-static-MD-Release.tar.bz2 | 217 MB | `.models/sherpa-bin` |
| kokoro-int8-multi-lang-v1_0.tar.bz2 | 132 MB | `.models/voice-kokoro` |

- Voices: George (default English), Daniel, Lewis, Fable (British male), Emma, Isabella (British female), Michael, Onyx (American male); British voices use the British lexicon. French stays on Piper Siwis.
- Speed on this PC (CPU): about 1.3 s model load per call plus roughly real-time generation; a two-sentence line took 4.2 s. Long sentences are split at commas so speech starts sooner, but gaps between sentences are possible.
- English text is folded to ASCII before Kokoro (the sherpa command line cannot carry Unicode on Windows), so "Montréal" is spoken as "Montreal".
- If the Kokoro files are missing, English falls back to a Piper voice.

## Known limitations

- UI text is English only; conversation and speech are FR/EN.
- Memory and spelling preferences apply to new conversations (they are sent when a Codex thread starts).
- Piper's 2023 build is unmaintained; voice quality is not yet judged by the user.
- Whisper may invent text on noise; mitigated by push-to-talk, a minimum length, a silence check and removal of bracketed tags.
- Mic opens on each push-to-talk (privacy first), which can clip the first ~0.2 s of speech.
- The Codex path is the npm-global layout of 0.164; diagnostics show it if it moves.
- The speech-files folder is chosen in a native dialog only (JARVIS runs whisper/Piper executables from it), never typed or sent by the UI.
- Only command and file-change approvals are supported; other Codex requests (permissions, user-input questions, MCP prompts) are declined and logged.

## Privacy and permissions

- Codex runs with a read-only sandbox, `approvalPolicy: untrusted`, and approvals routed to the user (never a reviewer subagent). Each approval binds to a SHA-256 of the exact request, is single-use, and expires (default 300 s, then declined).
- Sent to OpenAI: your messages and saved memory items. Not sent: audio, files, screen.
- Audio exists only as a temp file during one transcription or synthesis call.
- No secrets are stored; Codex keeps its own login.

## Recovery

- Reset audio routing: Settings → Devices → choose devices again (or "System default").
- Codex stops: JARVIS restarts it on the next message and resumes the conversation's thread; if resume fails a new thread starts.
- Corrupt or unwanted state: close JARVIS and delete `%APPDATA%\jarvis\jarvis.db` (conversations, memory, settings) or the `logs` folder. Codex threads live in `~\.codex`.
- Diagnostics → Export writes a redacted JSON for troubleshooting.

## Next

1. Hands-on test of voice, devices, interrupt and edit.
2. P2 starts with the scoped file and document tools behind the approval broker.
