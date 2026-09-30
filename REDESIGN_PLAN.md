# 1.2 — interface, responsiveness and macOS

## Outcome

A calm, modern desktop with clear download actions, readable progress, accessible controls and a focused sidebar. Keep existing transfer, media, archive and browser features reachable. Electron is retained for the Mac release; Swift is deferred as authorized by the request.

## Implementation

1. Establish light/dark design tokens, system typography, consistent line icons, spacing, restrained motion and compact native window chrome.
2. Put New download, Playlist/video and Collect links at the top. Group download states and library types in the sidebar; move technical controls into menus and settings.
3. Simplify adding a link with advanced settings disclosed only when needed. Add row actions, keyboard navigation, command search, friendly empty states and clearer busy/error feedback.
4. Preserve row identity while progress changes, bound rendered history rows, coalesce progress events and checkpoint persistent state rather than writing on every update.
5. Remove Windows-only tool paths, add native Mac menus/shortcuts/window behavior and provide actual macOS media/archive binaries for both architectures.
6. Run engine, existing UI, extension, media and new interaction/performance checks; inspect screenshots in light/dark/small layouts. Build and test the final Windows portable EXE.
7. Build Mac packages and verify architectures, tool contents, permissions and framework links. Explicitly separate package inspection from native Mac execution. Include reproducible macOS build/test/signing instructions.

## Release acceptance

- Existing downloads, extension token and settings survive the upgrade.
- File/video/playlist entry points are discoverable without memorizing Tools menus.
- Progress does not replace focused list rows; large histories do not create thousands of DOM rows.
- Keyboard focus, reduced motion, text contrast and smaller windows remain usable.
- macOS packages contain Mach-O tools, never Windows executables. Mac launch and signing status are reported honestly.

References: [Electron platform support](https://www.electronjs.org/docs/latest/tutorial/support), [electron-builder v26 macOS packaging](https://www.electron.build/v26/docs/mac/), [yt-dlp release binaries](https://github.com/yt-dlp/yt-dlp#release-files), [FFmpeg static builds](https://github.com/eugeneware/ffmpeg-static).

## Verified iterations

Final checks cover 55 core cases, real media/torrent/archive fixtures, existing and modern UI workflows, the extension and Windows portable extraction/launch. A mixed completed/paused selection exposed a first-row-only button eligibility bug; controls now evaluate the whole selection and prune selected IDs through a set. See VERIFICATION.md for exact results, performance measurements and Mac runtime limits.
