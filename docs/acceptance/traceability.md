# Feature traceability checklist

Source: JARVIS specification v1.0 (2026-10-23). Every feature ID stays here until it is verified or explicitly excluded by the user.
Status values: `planned`, `implemented`, `verified`, `blocked`, `excluded-by-user`. Nothing is `implemented` until code exists; nothing is `verified` without linked evidence.

| ID | Phase | Feature | Status | Evidence / notes |
|---|---|---|---|---|
| C01 | P1 | FR/EN text chat, streaming, titles, search, export, task boundaries | planned | Model streaming proven in P0 probe ([p0 report](../p0/environment-and-codex.md)); no chat app yet |
| C02 | P1 | Push-to-talk, mic state, cancel, transcript preview/correction, text-only mode | planned | |
| C03 | P1 | Independent persistent input/output device selection, meter, tests, unplug detection | planned | P0 prototype passed in Edge (selection, meter, record, routed playback); unplug/persistence not verified |
| C04 | P1 | FR/EN ASR + TTS, language override, voices, FR-CA locale option | planned | Needs P0 speech benchmark (downloads not yet approved) |
| C05 | P1 | Stop speaking, interrupt, queue, no self-transcription | planned | |
| C06 | P2 | VAD, bounded hands-free, barge-in, spoken confirmations | planned | |
| C07 | P4 | Optional local wake word | planned | Optional; disabled until selected |
| C08 | P2 | Long-answer summaries, readout, sensitive-content notifications | planned | |
| C09 | P2 | Dictation into selected field with focus checks | planned | |
| C10 | P2 | Translation, rewriting, tutoring, grounded summaries | planned | |
| W01 | P2 | Launch/focus apps, bounded UI tasks with evidence | planned | |
| W02 | P2 | Workspace-scoped file operations, recoverable delete, dry-run bulk | planned | |
| W03 | P2 | Local content index with explicit roots | planned | |
| W04 | P2 | Markdown/DOCX create/edit, rendered verification | planned | |
| W05 | P2 | PDF read/extract/merge/split/OCR, page citations | planned | |
| W06 | P2 | XLSX/CSV analysis, formulas, charts, no macros | planned | |
| W07 | P2 | PPTX presentations, notes, layout QA | planned | |
| W08 | P2 | Image inspection, OCR, conversion, A/V metadata/transcription | planned | |
| W09 | P4 | Advanced media editing, app adapters, bounded screen share | planned | Optional |
| W10 | P2 | Scoped clipboard read/write | planned | |
| W11 | P2 | Window arrangement, shortcuts, media/volume controls | planned | |
| W12 | P2 | Downloads organization, duplicates, batch rename, reports | planned | |
| W13 | P2 | Read-only system diagnostics | planned | |
| W14 | P2 | On-demand window/screen explanation with redaction | planned | |
| B01 | P2 | Search, page reading, tabs, citations | planned | |
| B02 | P2 | Forms, authenticated flows, uploads with approvals | planned | |
| B03 | P2 | Source comparison, staleness, research notes | planned | |
| B04 | P3 | Shopping/travel research and cart/booking preparation | planned | |
| D01 | P2 | Repo inspection, scoped edits, build/test | planned | |
| D02 | P2 | Git workflows, reviewable patches | planned | |
| D03 | P2 | Typed terminal task wrappers, limits, tree cancellation | planned | |
| D04 | P3 | Issue/PR/CI integrations | planned | |
| D05 | P4 | Isolated test envs, dashboards, deployment adapters | planned | Optional |
| I01 | P3 | Email read/draft/approved send | planned | |
| I02 | P3 | Calendar read/write with conflict checks | planned | |
| I03 | P3 | Tasks, notes, reminders, notification inbox | planned | |
| I04 | P3 | OAuth connector setup, scopes, revocation | planned | |
| I05 | P3 | Messaging connectors with verification | planned | |
| M01 | P1 | Conversation continuity, explicit preferences, memory page | planned | |
| M02 | P3 | Source-linked long-term memory | planned | |
| M03 | P3 | Opt-in document retrieval | planned | |
| A01 | P3 | Durable one-time/recurring jobs, timezone/DST | planned | |
| A02 | P3 | User-defined monitoring | planned | |
| A03 | P3 | Proactive suggestions with evidence | planned | |
| A04 | P3 | Long-running job dashboard, crash recovery | planned | |
| A05 | P3 | Inspectable chained workflows | planned | |
| A06 | P4 | Parallel read-only workers | planned | |
| X01 | P4 | Phone companion | planned | Optional |
| X02 | P4 | Smart-home adapters | planned | Optional |
| X03 | P4 | Plugin SDK and manifests | planned | |
| X04 | P4 | Generative media via reviewed providers | planned | |
| O01 | P1 | Accessibility basics | planned | |
| O02 | P1 | Settings and effective configuration | planned | |
| O03 | P1–P4 | Redacted logs, audit, diagnostics, no telemetry | planned | |
| O04 | P3 | Encrypted backup/restore, migrations | planned | |
| O05 | P4 | Secure updates, license inventory, uninstall | planned | |

## P0 deliverables

| Deliverable | Status | Evidence |
|---|---|---|
| Environment recheck | done | [p0 report](../p0/environment-and-codex.md) §1 |
| Model access via Codex app-server | proven (happy path only) | [p0 report](../p0/environment-and-codex.md) §2; [probe](../../tools/p0/codex-probe.mjs) |
| Auth route decision (ADR) | decided: route A (Codex login) | [p0 report](../p0/environment-and-codex.md) §3 |
| FR/EN speech benchmark | partial: minimal check run, GPU ASR working | [p0 report](../p0/environment-and-codex.md) §2b; voice verdict and real-voice test pending |
| Output routing demonstration | done (user-reported) | [p0 report](../p0/environment-and-codex.md) §1; [test page](../../tools/p0/audio-routing.html) |
| Threat model, license inventory, wireframes | planned | |
