# Feature expansion research and implementation plan

Research date: 28 September 2026. This is a union of useful workflows, not a claim that the three products have identical internals or that every supported website can be reproduced.

## Primary sources

- [JDownloader Linkgrabber](https://jdownloader.org/knowledge/wiki/glossary/linkgrabber), [current support](https://support.jdownloader.org/en/knowledgebase/article/linkgrabber-how-to-add-links), [filters](https://support.jdownloader.org/sv/knowledgebase/article/linkgrabber-filters-and-views), [archive extraction](https://jdownloader.org/knowledge/wiki/addons/list/jdunrar).
- [4K Video Downloader Plus](https://www.4kdownload.com/products/videodownloader-42).
- [Free Download Manager feature list](https://www.freedownloadmanager.org/features.htm). This explicitly distinguishes current 6.x features from legacy 3.9 features.
- Implementation references: [yt-dlp options](https://github.com/yt-dlp/yt-dlp#usage-and-options), [WebTorrent API](https://webtorrent.io/docs).

## Distinct workflows and their destination in ODM

| Workflow | Inspiration | ODM placement and implementation |
|---|---|---|
| Collect links before downloading, inspect availability, deduplicate, filter and group into packages | JDownloader | Link Collector tool; persistent inbox, bounded parallel HEAD/range checks, package folder and queue selection |
| Automatic organization rules | JDownloader | Organization Rules tool; ordered host/extension rules set package/category/destination before a transfer starts |
| Archive contents and extraction | JDownloader | Completed file context menu; ZIP/7z/RAR/TAR inventory and selective extraction, transient password entry, traversal/link protection, fresh output folder, optional ZIP extraction after completion |
| Playlists, channels and search results with selection | 4K | Media Library tool; yt-dlp flat collection inspection, review/select entries, package queue import |
| Smart Mode | 4K | Media Preferences; persistent quality, video container, audio format, subtitle language and metadata preferences inherited by desktop/browser additions |
| Subtitles and richer media formats | 4K | Per-download media preferences; SRT subtitle sidecars, optional automatic captions, MP3/M4A/Opus/FLAC, MP4/MKV output |
| Channel/playlist subscriptions | 4K | Subscriptions tool; persistent seen identifiers, bounded polling while app runs, manual check, pause and error visibility |
| BitTorrent/magnets | FDM | Add Torrent tool; metadata/file selection, verified pieces, peer/progress display, pause/resume, isolated working storage and stop at completion |
| Traffic profiles | FDM | Traffic tool; Full/Balanced/Browsing/Custom presets, shared direct-file limit, explicit torrent upload limit |
| Audio/video conversion | FDM | Completed media context menu; bundled FFmpeg MP4/MP3/M4A/FLAC conversion to a new file with progress/errors |
| Video/audio preview | FDM | Completed file context menu opens system media player. Progressive preview needs a local range server and is assessed separately |
| Mirror failover | FDM legacy 3.9 | Per-download mirror list; restart safely on a different server unless bytes are independently validated |
| Download selected files from a remote ZIP | FDM legacy 3.9 | Remote ZIP Selection tool; read central-directory ranges and selected entry ranges, validate server identity and CRC, report transferred bytes |
| Website crawling | FDM legacy 3.9 | Site Grabber; bounded same-origin crawl, depth/page/file limits, extension filters and result review |
| Remote access, accounts and host plugins | JDownloader/FDM/4K | Existing local browser bridge and explicit site cookies retained. Internet remote control, cloud accounts and thousands of host-specific plugins require separate service/site work |
| AI audio processing, mobile apps, translations, router reconnect, CAPTCHA/account automation | Product-specific | Light/dark/system themes are implemented in 1.2. Record the other items as remaining product scope; these require additional models, platforms, assets or services rather than a cosmetic toggle |

## Build order and verification

1. Add reusable collection/media/archive/torrent modules and migrate existing state without losing jobs, queues or the paired extension token.
2. Integrate narrow IPC commands and dedicated desktop dialogs. Preserve classic toolbar navigation and existing tests.
3. Test local HTTP fixtures, duplicate/rule behavior, state reload, collection/subscription deduplication, subtitles/media conversion, archive traversal rejection, and a real local torrent swarm.
4. Exercise the new dialogs in Electron, run existing engine/extension suites, then build and test the actual portable executable. Live website tests supplement deterministic fixtures and do not prove universal site compatibility.
5. Publish an explicit implemented/remaining matrix and fresh verification results. Keep the current running 1.0 app and its user data intact until the replacement is ready.

## 1.3 long-running batches and cloud archive

The requested session sharing, engine updates, multiple playlist folders, per-batch pacing, S3/GCS offload and errors-only notification controls are implemented. Research, source placement, workflow and limits are recorded in [BATCHES.md](BATCHES.md). Cloud storage is a download/assemble/upload/verify/cleanup pipeline with local working space; it is not direct remote streaming.
