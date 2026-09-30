# Research → Plan → Build → Verify → Iterate

Built on Windows x64 on September 28, 2026.

## Research

The reference was IDM's official documentation for its [main window](https://www.internetdownloadmanager.com/support/main.html), [options](https://www.internetdownloadmanager.com/support/options.html), [scheduler](https://www.internetdownloadmanager.com/support/schedulerD.html) and [dynamic segmentation](https://www.internetdownloadmanager.com/support/segmentation.html). Its documented workflow guided the category tree, toolbar, transfer controls, properties, queue behavior and connection progress view.

The implementation uses the maintained [yt-dlp video engine](https://github.com/yt-dlp/yt-dlp), its [external JavaScript runtime requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS), Chrome's [downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads) and [webRequest API](https://developer.chrome.com/docs/extensions/reference/api/webRequest), Electron's [security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [Windows storage encryption](https://www.electronjs.org/docs/latest/api/safe-storage), and [basic-ftp](https://github.com/patrickjuchli/basic-ftp) for FTP.

## Plan and implementation choices

Use Electron for the Windows desktop and built-in Node streams for the transfer engine. Keep the renderer sandboxed, expose a narrow IPC interface, and isolate browser handoff behind a token-authenticated loopback service. Build an unpacked Manifest V3 extension that can be installed locally without publishing to a browser store.

Persist transfer positions, reconstruct saved byte counts from partial files, validate every range response, and compare validators before resuming. Assemble segments in byte order, refuse overwrites, and calculate checksums. Use external yt-dlp/FFmpeg processes for site extraction and media merging rather than attempting to reproduce proprietary video extractors.

## Iterations that changed the result

- Replaced fixed splitting with dynamic in-half subdivision and added a slow-connection regression test.
- Fixed an extension initialization race that overwrote pairing settings.
- Fixed popup media selection when the popup runs in a browser tab.
- Added pointer detection through player overlays, then verified it on the actual YouTube player.
- Made the extension's quality arrow open a functional menu.
- Added optional, domain-scoped cookies and encrypted desktop credential persistence.
- Added editable categories, custom save folders, queue ordering and daily schedules.
- Fixed stale partial bytes after changing a URL; added a separate validator-preserving refresh action.
- Corrected Options so Cancel discards changes even after switching tabs.
- Copied the packaged extension to persistent application data so portable extraction cleanup does not remove it.
- Added FTP REST recovery, collision protection and streaming checksums.

## Verification

Tests exercise real local HTTP/FTP servers, the real Windows desktop, a loaded browser extension and live YouTube extraction. Screenshots are saved under `test-results/` during UI/browser runs. The final verification report lists the completed commands and remaining limits; these checks do not imply compatibility with every site or server.

## 1.1 expansion

Research and feature placement are recorded in FEATURE_RESEARCH.md. Collection indexing was corrected after a real yt-dlp fixture returned multiple videos under the same page URL. Torrent peer transfer and selected-file restart were tested with real WebTorrent clients, a local tracker and byte comparisons. Remote ZIP selection reads verified ranges and checks CRC. Archive passwords are transient. Bundled 7-Zip supports encrypted archives; original archives and media remain intact.

The WebTorrent dependency tree reports four high npm audit entries tracing to the same ip.isPublic advisory (GHSA-2p57-rm9w-gvfp). The reference found in bittorrent-tracker/lib/server/parse-udp.js belongs to its tracker server; ODM uses the tracker client and never starts that server. This is a dependency advisory with an unused affected server path, not a clean audit. Optional native WebRTC/uTP modules are disabled and npmRebuild=false avoids rebuilding them during packaging. No downgrade to the obsolete WebTorrent 0.7.3 suggested by npm audit was applied.

## 1.2 interface and platform iteration

The modern presentation layers preserve the existing feature workflows. Keyed rows preserve DOM identity and focused controls; histories above 80 entries use fixed-height virtualization with overscan. A requestAnimationFrame scheduler coalesces rendering. Active transfers send deltas at most every 100 ms; persistence checkpoints are scheduled at 2 seconds, with immediate structural saves and a final close save. Torrent metadata and credentials are omitted from renderer snapshots.

Collections and collector packages batch structural saves/snapshots and queue starts. Large paused histories no longer save each entry during close. Inspection IPC tracks cancellable process IDs; closed dialogs stop inspection and playlist preferences preserve drafts. Keyboard controls, menu focus, label associations, dark/system appearance and reduced motion are covered by interaction tests.

Electron-builder 26 refuses macOS targets on Windows. Rather than relabel a Windows binary, the cross assembly copies checksum-verified official Electron Mac ZIP entries, retaining framework symlinks and executable modes. ASAR header integrity, bundle/helper metadata, platform-native tools and original Mach-O code pages are checked. The assembly never modifies Mach-O bytes and does not claim Developer ID signing or notarization. Native macOS launch, Keychain, notifications and tool execution remain unverified. MACOS.md records those limits and the native build workflow.

Bulk selections validate IDs before mutation, resume/pause with one snapshot, and remove temporary files in bounded asynchronous groups. Completed files are preserved. The UI exercises bulk controls and removal cancellation alongside engine tests.

## Stability release 1.2.1

Completed 23 finding / fix / verification iterations. The complete backend suite passed 77 tests. Source and packaged Electron dialog-race, modern UX and desktop workflows passed, as did packaged expansion UI, browser extension, actual media conversions and the portable EXE with live YouTube. See STABILITY_ITERATIONS.md and VERIFICATION.md for evidence and platform limits.

## Performance release 1.2.2

Studied IDM's documented dynamic segmentation/connection reuse and yt-dlp's fragment concurrency. Added balanced initial ranges, bounded persistent connection pools, reused probe sockets/resolved URLs, conservative 429/503 connection backoff, bounded disk buffers, 1 MiB assembly reads and same-filesystem hard-link publication after verification. The desktop queues compact durable history transactions asynchronously and reuses encrypted credentials. Renderer indexing, cached summaries and unchanged DOM/spacer reuse reduce progress work while preserving focus. HLS/DASH gets up to four native fragment workers.

85 backend tests passed. Final source and packaged desktop/modern/dialog-race checks passed; packaged expansion UI, loaded extension, actual media conversions/HLS and final portable EXE with live audio/video merge passed. Computer use opened the normal release, visibly exercised New download and confirmed the saved job/settings/file SHA-256 and existing browser connection. Windows and Mac ASARs match source; both Mac archives passed structural/binary integrity checks. Native Mac execution is still untested. PERFORMANCE.md, VERIFICATION.md and benchmarks/ contain the controlled measurements and reproducible baseline.

## Batch release 1.3.0

Added an encrypted credential vault, nonce-bound extension session helper, shared YouTube policy, official checksum/version-verified yt-dlp updates, persistent multi-playlist batches, S3 multipart/GCS resumable upload with checkpointed verification before cleanup, disk-space holds and errors-only notifications. Cloud SDKs load on demand. See BATCHES.md for exact defaults and workflow. Fault tests found and fixed import cooldown retry state, early-abort cookie cleanup, tampered pending updates, empty GCS uploads, repeated missing multipart sessions, forgotten-secret backup recovery and zero-clock notification deduplication. Source and packaged verification results are recorded in VERIFICATION.md.
