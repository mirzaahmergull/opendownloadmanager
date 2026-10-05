# Changelog

## Unreleased

- Cloudflare R2 cloud destinations alongside Amazon S3 and Google Cloud Storage: account-ID endpoint derivation, EU/FedRAMP jurisdictions, encrypted or `R2_*` environment credentials, `Content-MD5`-validated single and resumable multipart uploads with ETag verification before local cleanup.

## 1.3.0 — 2026-09-30

First public open-source release.

- Multiple playlists in durable batches with a separate folder per playlist, pause/resume, failed-import recovery and optional restart resume.
- Explicit YouTube session sharing through the Chrome/Edge extension, OS-encrypted storage, optional refresh and Forget.
- Adjustable gaps, concurrency, rest periods and shared cooldowns that hold YouTube work on recognized rate/session challenges.
- S3 and Google Cloud Storage destinations, resumable verified uploads, optional local cleanup and storage/upload failure holds.
- Automatic official yt-dlp updates with SHA-256 and executable/version checks, idle activation and rollback.
- Configurable notifications, defaulting to errors and blockages only.
- Public source, contributor guide, issue templates, screenshot, Windows CI and a manual draft-release build workflow.

The backend suite passes 111 tests. Packaged Windows workflows were verified; native macOS execution and production cloud credentials remain untested. The final anonymous live YouTube check encountered a bot challenge and verified queue blocking, not a completed download.

## 1.2.2 — 2026-09-30

- Reduced transfer overhead through balanced ranges, connection reuse, buffered writes and asynchronous persistence.
- Stable focused rows during progress, bounded rendering for large histories, and HLS/DASH fragment concurrency.
- Controlled throughput and renderer benchmarks; see [PERFORMANCE](PERFORMANCE.md).

## 1.2.1 — 2026-09-30

- 23 stability iterations covering history recovery, transfer integrity, safe output publication, cancellation and dialog races.

## 1.2.0 — Local development milestone

- Modern light/dark desktop interface, command search, simplified download actions and playlist controls.
- Electron macOS arm64/x64 development packages and platform-specific menus/paths.

## 1.1.0 / 1.0.0 — Initial development

- Segmented HTTP transfers, FTP/FTPS, queues/scheduling, browser integration and yt-dlp/FFmpeg media downloads.
- Link Collector, media subscriptions, torrent selection, archives, remote ZIP selection, conversion and organization rules.

Earlier entries summarize local development milestones; historical release tags and binaries are not published.
