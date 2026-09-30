# Contributing

Issues and pull requests are welcome. Describe the user-visible problem, expected behavior and a small reproduction. For media extraction, first note the yt-dlp version and whether the upstream extractor has the same issue. Never include cookies, pairing tokens, credentials, private URLs or unsanitized download history.

## Development

Use Node.js 24 or later. Install with `npm ci --ignore-scripts`, then `node node_modules/electron/install.js` and `npm rebuild node-datachannel`. WebTorrent imports this native dependency even though ODM disables WebRTC peer transport; skipping its installation breaks torrent imports. On Windows run `npm run setup:windows`; on a Mac run `npm run setup:mac`. These commands download third-party tools from upstream and verify checksums. `npm start` launches the app. See [README](README.md) and [MACOS](MACOS.md) for platform limits.

Run `npm test` for the deterministic backend suite and `npm run test:ui`, `npm run test:modern`, and `npm run test:batches` for affected desktop flows. Tests use temporary app data. Run `npx playwright install chromium` before extension tests. Live YouTube/cloud-account tests are opt-in; do not require private credentials in CI. macOS backend mock coverage is currently incomplete; Windows CI is the supported full-suite runner.

Keep pull requests focused. Explain the problem, change and checks performed. Add regression coverage for meaningful transfer/recovery failures. Preserve cancellation, durable checkpoints and credential redaction. Match the nearby CommonJS and renderer patterns; there is no additional formatter requirement.

Original contributions are made under the repository's MIT license. Do not submit proprietary code, copied product icons, credentials or binaries; third-party components retain their own licenses. No CLA is required.

## Security reports

Report suspected vulnerabilities privately through the repository's Security → Report a vulnerability flow when available. If private reporting is unavailable, open an issue requesting a private reporting channel without exploit details or secrets. Do not attach real browser sessions or cloud keys. There is no guaranteed response time or security-support SLA.

## Releases

See [RELEASING](RELEASING.md). Published assets must describe their validation and signing status. Do not claim native Mac verification from ZIP inspection, or a successful live download from a handled YouTube block.
