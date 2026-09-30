# Version 1.3.0 verification

Verified on Windows x64, 30 September 2026. Results describe the tested conditions; live service access and native Mac behavior are separate limitations.

| Check | Result |
|---|---|
| Backend `npm test` | **111 passed, 0 failed**, 43.34 seconds. Includes 26 new batch/session/cloud/updater regressions and 85 existing transfer, media, persistence, archive, torrent, stability and performance regressions. Log: `test-results/batch-backend.log`. |
| Large batch recovery | Passed: 5,000 imported entries, separate playlist folders, scoped duplicates, durable restart, explicit pause/resume, aborted imports, removal and blocked/low-space holds. This is not a 5,000-video live YouTube endurance run. |
| Cookie sharing | Passed with isolated Chromium and synthetic cookies: helper handoff, explicit sharing, only YouTube cookies retained, OS encryption, refresh opt-in, public-secret exclusion, forget/backup removal, concurrent refresh versus forget protection, and temporary jar cleanup after abort/restart. Production Chrome cookies were not copied by the agent. |
| Pacing and notifications | Passed: shared concurrency, completion gaps/rest, cooldown escalation and challenge holds; 5,000 completion events produce no completion notifications in errors-only mode; repeated attention deduplicates. |
| S3 actual SDK | Passed against a local signed protocol fixture: exact bytes, checksum readback, conditional creation, multipart failure/restart with part reuse, sidecars, durable checkpoints, changed-local-file protection, cancellation and deletion ordering. |
| GCS actual SDK | Passed against a local resumable protocol fixture: SDK session creation, interrupted/chunked upload, acknowledged offsets, encrypted session restart, empty objects, checksum rejection and verified cleanup. SDK loading and a 9 MiB resumable upload also passed inside the packaged app. |
| Automatic engine updater | Passed mocked corruption/offline/busy/pending/rollback/restart tests and actual official GitHub release download (2026.08.19), SHA-256/native executable/version checks, activation and rollback. Packaged IPC updater also passed. |
| Packaged batch UI | Passed settings draft/cancel/save, encrypted destination editing/test, browser helper request, two actual local yt-dlp collections in separate folders, signed S3 uploads with exact bytes, verified local deletion, cloud URI copy, and batch removal retaining remote objects. |
| Existing desktop workflows | Source and final packaged desktop, expansion, modern and delayed-operation stability UI tests passed with no renderer errors. Includes exact download bytes, settings, pairing, collector, media, torrent and archive workflows. |
| Media and extension | Isolated extension pairing/hover/detection/capture tests passed; actual local yt-dlp collection, subtitles, MKV/metadata and MP3/M4A/FLAC checked with FFprobe; HLS fixture observed four simultaneous fragment requests. |
| Final portable Windows EXE | Passed extraction/launch, file byte/SHA-256 integrity, bridge pairing, persistent extension, local video with both audio and video streams, and clean exit. Optional live YouTube request returned a sign-in/bot challenge: **shared queue blocked for review, one strike**, verified. **Live YouTube download did not complete in this run.** |
| Normal-session upgrade | Opened final 1.3.0 through computer use, displayed its batch setup, and preserved **138 saved downloads**, all recorded output paths/checksums, every actual file SHA-256 and existing settings. Existing Chrome pairing reconnected without re-pairing. Upgrade evidence remains private and is excluded from the public repository. |
| Windows ASAR | Every bundled `src/` file matched final source byte-for-byte. |
| macOS archives | Structural checks cover CRCs, resolving framework symlinks, executable permissions, Mach-O architectures, ASAR integrity/source equality, excluded Windows/native binaries and upstream code-page hashes. **Native Mac launch is untested.** |

## Responsiveness

The final packaged modern UI test used 20,000 synthetic history entries: **25 rendered rows**, initial render **21.2 ms**, progress-render p95 **0.2 ms**, and zero child-list mutations across 20 progress renders of unchanged visible rows. Source progress p95 was 0.3 ms. These measure renderer work rather than network throughput or every OS frame; results vary under concurrent load.

Existing controlled throughput fixtures and frozen baselines remain in `PERFORMANCE.md` and `benchmarks/`. Active progress is coalesced at 100 ms, with periodic checkpoints at two seconds; structural persistence is serialized asynchronously and flushed at shutdown. These tests do not establish an internet speed guarantee.

## Coverage boundaries

- Anonymous live YouTube was blocked in the final test. Cookies may expire or face account checks; cookies and delays cannot guarantee access. No CAPTCHA solving, account rotation or DRM bypass is provided.
- Actual AWS/GCS user accounts, OAuth, IAM/KMS, service quotas and billing have not been tested. Local fixtures exercised actual SDKs and byte/checksum protocols. Configure and test a real destination before a large batch.
- Cloud offload requires working space for the current media streams, assembly and sidecars. Upload failures and disk-full conditions hold the batch. It is not direct-to-cloud streaming.
- Automatic updates cover yt-dlp only; app, extension, FFmpeg and other tools are not automatically replaced.
- Mac arm64/x64 are Electron development bundles for macOS 13+. Swift is deferred. Native launch, Keychain, notifications, browser interaction and media execution have not been exercised. Bundles are not Developer ID signed/notarized; Windows portable build is unsigned.
- Existing subscription, torrent, archive and remote-ZIP scope remains as documented in README and FEATURE_RESEARCH. No universal parity with competing applications is claimed.

## Dependency audit

`npm audit --omit=dev` retains four high entries tracing to GHSA-2p57-rm9w-gvfp through WebTorrent -> torrent-discovery -> bittorrent-tracker -> ip. The affected `ip.isPublic` call is in the tracker-server UDP parser; ODM uses a tracker client and does not run that server. The advisory remains in the dependency graph. The newly added GCS transitive UUID advisory was resolved with a scoped supported override.

## Windows executable

`release/OpenDownloadManager-1.3.0-Windows.exe`: **278765758 bytes**.

SHA-256: `3bf6d59a2ae12e1558ce07d5e6b4163af91694afbf55096eb025e50dba970fe0`.

Public source/extension hashes are attached to the release as SHA256SUMS.txt. Local desktop builds remain in a draft pending redistribution review. Detailed operation/setup guidance is in BATCHES.md; generated test screenshots are excluded from Git.

## Public distribution review

Runtime tests do not establish redistribution rights. Static inspection of bundled Apple Silicon FFmpeg found `--enable-nonfree`; those app binaries are not published. Windows FFmpeg is a GPLv3 static build with many external libraries; the current application source archive does not include their complete corresponding sources/build materials. Public 1.3.0 assets therefore contain application source and extension only.
