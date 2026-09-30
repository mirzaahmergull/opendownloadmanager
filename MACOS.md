# macOS release

Two local Electron app ZIPs were prepared: **arm64** for Apple Silicon and **x64** for Intel. Electron 44 requires **macOS 13 or later**. Swift is not used in this release.

## Public distribution

The local app ZIPs are not public release assets. Inspection found `--enable-nonfree` in the bundled Apple Silicon FFmpeg. Replace that media binary with a redistributable build and supply corresponding sources before distributing a Mac package. Setup scripts reproduce the tested local tools; they do not approve redistribution. See [RELEASING.md](RELEASING.md).

## Status

These packages were assembled on Windows from checksum-verified official Electron Mac distributions. The application ASAR comes from the tested 1.3 source; disabled native/Windows dependency binaries are omitted. ZIP metadata preserves framework symbolic links and executable permissions. Architecture-specific FFmpeg/FFprobe, universal yt-dlp and universal 7-Zip are bundled.

The app has Mac window controls, native application/File/Edit/View/Window menus, Command shortcuts, system appearance support, a template menu-bar icon and Dock activation behavior. Download folders use Electron's native system paths. Credentials use Electron safeStorage on the host platform.

**Native Mac execution has not been tested on this Windows machine.** Package CRC, framework links, executable paths/permissions, Mach-O architecture and embedded code-page hashes are checked by `test/macos-package.py`. Those checks cannot prove that launch, Keychain prompts, notifications or media extraction work on a physical Mac.

The original Electron/tool Mach-O bytes retain their upstream signatures; no Apple Developer ID signature or notarization is claimed. These are development builds. A publicly distributed Mac release should be built/tested, Developer ID signed and notarized on an appropriate build host. Do not weaken system security settings to install it.

## Use

Choose the ZIP for your processor, extract it with macOS Archive Utility and copy **Open Download Manager.app** to Applications. Open it normally. If macOS rejects it, stop and use a Mac build/signing workflow rather than treating the package inspection as proof that it is trusted by Gatekeeper.

Chrome/Edge integration uses the same unpacked extension. The app's Browser panel displays the persistent extension directory and pairing token. Safari integration is not included.

## Reproduce and test on a Mac

With Node installed, from the source directory:

```sh
npm ci --ignore-scripts
node node_modules/electron/install.js
npm rebuild node-datachannel
npm run setup:mac
npm test
npm start
npm run test:ui
node test/advanced-ui.cjs
npm run test:modern
npm run test:extension
node test/advanced-media.cjs
npm run build:mac
```

The existing Windows-specific portable test is not a Mac launcher test. On a Mac, additionally open the packaged `.app`, add a real HTTP file and a supported video, verify pause/restart, play converted output, inspect an archive, pair the browser extension, quit/reopen and check preserved history. Test on both Apple Silicon and Intel before claiming coverage for both architectures.

`tools/package-macos.py` is the Windows assembly path; it reads verified Electron ZIPs directly so Windows cannot flatten framework links. `tools/mac-asar.cjs` prepares the platform-independent ASAR from the tested Windows directory. `tools/build-macos.cjs` uses standard electron-builder when running on macOS.

## Components and sources

- [Electron 44.4.5](https://github.com/electron/electron/releases/tag/v44.4.5), original Mac ZIP SHA-256 digests recorded in the build cache.
- [yt-dlp 2026.08.19](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19), universal executable verified against upstream SHA2-256SUMS.
- [FFmpeg static b6.1.1](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1), FFmpeg/FFprobe 6.1.1 for each architecture, checked against release-asset digests. Original license/README notices and source manifest are bundled.
- [7-Zip 26.03](https://github.com/ip7z/7zip/releases/tag/26.03), universal `7zz`, verified release digest and license bundled.

This component set differs from the Windows FFmpeg 9.0 build. Capability and native-runtime testing must account for that difference.
