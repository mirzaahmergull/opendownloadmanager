# Third-party components

The original Open Download Manager application source and original icons are MIT licensed. Third-party programs are independent components and retain their licenses.

| Component | Version in this build | License / source |
|---|---|---|
| Electron | 44.4.5 | MIT and bundled Chromium/Node notices; see the runtime's LICENSE and LICENSES.chromium.html |
| yt-dlp Windows executable | 2026.08.19 | Official release binary and bundled dependencies; see its upstream licensing documentation and included notices |
| FFmpeg / FFprobe | 9.0-full_build-www.gyan.dev | GPL v3 build; see tools/licenses/FFmpeg-LICENSE.txt and FFmpeg-README.txt |
| FFmpeg / FFprobe in macOS builds | 6.1.1, ffmpeg-static release b6.1.1 | Architecture-specific upstream license/README and SHA-256 source manifest in tools/licenses; https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1 |
| basic-ftp | Locked in package-lock.json | MIT; installed package includes LICENSE.txt |
| WebTorrent | 3.0.21 | MIT; https://github.com/webtorrent/webtorrent |
| yauzl | 3.4.0 | MIT; https://github.com/thejoshwolfe/yauzl |
| 7-Zip executable and DLL | 26.03 | LGPL with unRAR restriction and BSD components; see tools/licenses/7zip.txt and https://github.com/ip7z/7zip/tree/26.03 |
| http-proxy-agent / https-proxy-agent / socks-proxy-agent | Locked in package-lock.json | MIT; installed packages include license files |
| electron-builder / Playwright | Locked in package-lock.json | Development/build/test tools, not required by users of the packaged app |

Upstream projects and exact release sources:

- Electron: https://github.com/electron/electron/releases/tag/v44.4.5
- yt-dlp: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19
- yt-dlp source and license: https://github.com/yt-dlp/yt-dlp/tree/2026.08.19
- yt-dlp dependency licensing: https://github.com/yt-dlp/yt-dlp#license
- FFmpeg build supplier: https://www.gyan.dev/ffmpeg/builds/
- FFmpeg source revision specified by the build supplier: https://github.com/FFmpeg/FFmpeg/commit/d32b387f2b
- basic-ftp: https://github.com/patrickjuchli/basic-ftp
- Proxy agents: https://github.com/TooTallNate/proxy-agents

The desktop binary is unsigned. No proprietary IDM executable, icon, logo, serial key or patch is bundled.

Windows is unsigned. macOS packages preserve upstream executable bytes but are not Developer ID signed or notarized; see MACOS.md. Mac bundles include Electron's original license notices and universal yt-dlp/7-Zip tools plus architecture-specific FFmpeg/FFprobe.

7-Zip was fetched from the official ip7z release and checked against its release asset SHA-256. Its source and digest are recorded in tools/licenses/7zip-source.json. Torrent support uses TCP peers and HTTP/UDP trackers; optional native WebRTC/uTP modules are disabled.

Cloud storage uses the official AWS SDK for JavaScript (`@aws-sdk/client-s3`, Apache-2.0; also used for Cloudflare R2's S3-compatible API) and Google Cloud Storage Node client (`@google-cloud/storage`, Apache-2.0), locked in package-lock.json. Their notices/licenses remain in the installed dependency packages. A scoped gaxios→uuid 11.1.1-compatible override avoids GHSA-w5hq-g745-h8pq; cloud protocol tests exercise the resulting dependency tree.

## Public release policy

The source repository and public 1.3.0 release exclude native third-party binaries. The Apple Silicon FFmpeg build declares `--enable-nonfree` and must be replaced before redistribution. Windows static FFmpeg requires complete corresponding sources, including external libraries and build materials. Upstream source links alone are not claimed as a completed distribution review. See RELEASING.md.
