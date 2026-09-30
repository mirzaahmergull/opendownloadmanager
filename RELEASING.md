# Releases

Original application source and assets are MIT licensed. Keep native third-party binaries out of Git. `npm run release:assets` creates a ZIP of committed source, an unpacked extension ZIP and SHA-256 checksums in `release/`.

## Public source release

1. Update package.json/package-lock.json, extension/manifest.json and CHANGELOG.md to the same version. Record actual platform/test limits in VERIFICATION.md.
2. Run relevant backend and desktop checks and wait for CI to pass. Review `git diff --cached`; exclude credentials, history, generated fixtures, third-party binaries and private screenshots.
3. Commit and push `main`, then create and push an annotated `vX.Y.Z` tag at the tested commit.
4. Run **Release source** using that tag. The default creates a draft; inspect ZIPs and checksums before publishing. A deliberate `publish` input publishes after validation. The workflow refuses a tag/version mismatch and refuses to overwrite an existing release.

The workflow uses GitHub CLI with job-scoped `contents: write` and pinned action revisions. It accepts tagged repository source, never arbitrary fork code with a write token. Public source releases do not imply native desktop testing.

## Packaged application gate

Local 1.3.0 Windows/Mac builds were tested as documented but are held in a maintainer draft. Outstanding packaging work:

- Apple Silicon's upstream FFmpeg declares `--enable-nonfree`. Replace it with a redistributable build; availability upstream does not establish redistribution rights.
- Windows FFmpeg is a GPLv3 static build. Provide complete corresponding sources and build materials for FFmpeg and statically linked libraries, matching the actual binary. The bundled README records revision, configuration and library versions. Application source is not that third-party source bundle.
- Preserve component licenses, notices, source manifests and source access. Review the specific Intel Mac media build too.
- Run native Mac launch, transfers, Keychain, notifications and extension tests on each architecture. Developer ID signing/notarization and Windows signing remain unconfigured.

Setup scripts download upstream tools for local development and CI. Consult [FFmpeg licensing guidance](https://ffmpeg.org/legal.html) and the specific notices in THIRD_PARTY.md before binary distribution.

After resolving these checks, build with `npm run build` on Windows and `npm run build:mac` on macOS. Test final packages and compute SHA256SUMS.txt after packaging. Do not replace published assets with different bytes under the same version.
