# Performance pass — 1.2.2

Measured on Windows x64, 30 September 2026. This pass improves transfer overhead and interaction latency. It does not increase the bandwidth supplied by the source server or ISP.

## Research

IDM documents dynamic splitting of the largest unfinished segment, connection reuse and minimizing connection negotiation: [official feature explanation](https://http.internetdownloadmanager.com/features2.html). Its implementation is proprietary; this work uses its documented strategy rather than claiming access to its source. Its [speed FAQ](https://www.internetdownloadmanager.com/register/new_faq/functions8.html) also identifies source, ISP, competing traffic and connection count as practical limits. [yt-dlp's download options](https://github.com/yt-dlp/yt-dlp/blob/master/README.md#download-options) document concurrent fragments for DASH/native HLS.

## Implemented improvements

- Start large range-capable files with balanced ranges, then split remaining slow ranges dynamically. Small files use fewer connections.
- Explicit bounded keep-alive pools, consumed one-byte probes and direct use of the resolved download URL avoid unnecessary socket setup and repeated redirects. Cross-origin Authorization/Cookie stripping is preserved.
- Servers returning 429 trigger a one-connection retry; 503 reduces the transfer connection count. Existing retry limits and checksum validation remain in effect.
- Bounded write aggregation reduces small disk operations. Range-aware buffer sizes and a 100 ms flush opportunity retain early progress and reliable pause offsets. Assembly reads use 1 MiB buffers.
- Verified files publish using hard links on the same filesystem, avoiding an additional whole-file copy. Unsupported links and other filesystems retain the copy/reservation fallback.
- Desktop durable history writes and backup transactions run asynchronously and serialize/coalesce pending saves. Shutdown waits for the final transaction. State JSON is compact; unchanged encrypted credentials are reused, and identical empty credentials share one encryption/decryption result.
- Renderer progress uses an ID index and cached active-job summary. Sidebar counts use one pass; search changes coalesce at animation frames. Unchanged labels/status text are left in place and virtual spacers are reused, avoiding layout invalidation and row mutations during unchanged progress. The existing virtualized rows and focused buttons remain stable.
- Native HLS/DASH downloads use up to four fragment workers, bounded by the connection setting. This does not affect servers that only provide a single progressive media file.

## Controlled transfer measurements

`node test/performance.cjs` serves a deterministic 16 MiB payload locally. The server attempts 64 KiB writes every 5 ms per connection; Windows timer resolution affects the realized rate. The uneven endpoint gives nonzero ranges a 1 ms interval. Every result verifies final bytes and SHA-256. These are end-to-end completion measurements, including assembly/publication, rather than an Internet speed claim.

| Fixture | Previous engine | 1.2.2 engine | Observation |
|---|---:|---:|---|
| One capped connection | 4090.7 ms | 4125.0 ms | Source-limited; effectively unchanged |
| Eight capped connections | 617.5 ms | 588.1 ms | 4.8% less completion time |
| Uneven connections | 377.1 ms | 279.6 ms | 25.9% less completion time |

Eight connections in this updated run completed about 7 times faster than the single-connection case. This comparison demonstrates overcoming per-connection throttling; the previous engine already supported parallel transfers. Repeated observed runs varied with system load. Socket counters in the raw reports count newly opened TCP sockets, so zero means previously pooled sockets were reused.

## UI and verification

The existing modern UI benchmark uses 20,000 synthetic history records and 25 rendered rows. The previous packaged renderer measured initial render 33.0 ms and progress-render p95 2.9 ms; final source measured initial render 35.8 ms and progress-render p95 0.4 ms during a concurrent build. Across observed final-source runs progress p95 was 0.3–0.4 ms. Initial render varied with load; the release does not claim a universal startup improvement. These measure JavaScript/DOM render work, not guaranteed frame rate or every input path. The final packaged fixture measured initial render 24.9 ms and progress-render p95 1.0 ms, compared with the previous packaged 33.0 ms / 2.9 ms run. This is roughly 66% less progress-render work in this fixture. Full verification is recorded in VERIFICATION.md. The fixture also verifies zero child-list mutations within the unchanged visible rows across 20 progress renders. Raw reports and the frozen previous engine are in `benchmarks/`.

85 backend tests passed, including eight new performance regressions. Tests cover exact balanced-range bytes, fewer part-file writes, reused sockets, no-copy publication, cross-origin redirects, 429 recovery, credential reuse and asynchronous save failure/coalescing/shutdown. The actual HLS fixture observed four simultaneous fragment requests; FFprobe verified audio and video in the completed file. Pause/restart, integrity, FTP, torrent, archive and existing UI workflows remain covered.

Reproduce with `npm test`, `node test/performance.cjs`, `npm run test:modern`, `node test/fragment-video.cjs`, and `node test/advanced-media.cjs`. The backend benchmark accepts ODM_BENCH_ENGINE for an archived engine module and ODM_BENCH_REPORT for a JSON result path. Native Mac execution still requires a Mac; cross-built Mac archive checks do not establish runtime performance.
