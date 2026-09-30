# Stability iteration ledger

Each numbered iteration identifies a concrete failure mode, changes the implementation and verifies it with a regression or integration check. Existing workflows are tested again before packaging. Native Mac launch testing remains unavailable on this Windows host.

| Iteration | Failure mode and improvement | Verification |
|---|---|---|
| 01 | Malformed history could partially replace engine defaults. Validate the complete state before applying it; retain the unreadable file. | Malformed-state fixture |
| 02 | A damaged primary file had no automatic recovery. Keep a known-good rolling backup and recover it. | Corrupt primary / restart / preserved IDs |
| 03 | Encryption and JSON serialization failures escaped the save handler. Catch the whole transaction and retain the primary. | Injected encryption failure and cyclic state |
| 04 | Repeated quit requests repeated shutdown; new jobs could enter during close. Share the shutdown promise and reject new work. | Concurrent close calls / late add |
| 05 | Manual Resume retained automatic retry backoff. Clear the delay for individual and bulk controls. | Saved future retry deadline |

| 06 | Reject invalid queue dates before mutation; advance ancient daily dates without looping over every day. | Invalid-input preservation and year 0001 schedule |
| 07 | Close HTTP streams when partial-file opening fails. | Injected disk-open failure; server observes disconnect |
| 08 | Reject ranges whose Last-Modified changes during transfer. | Two-validator HTTP fixture; no publication |
| 09 | Reject unsolicited compressed representations. | Server ignores identity encoding; probe fails safely |
| 10 | Close redirect bodies immediately. | Never-ending redirect stream; destination succeeds |
| 11 | Enforce expected SHA-256 for FTP before publication. | Real FTP mismatch and successful matching checksum |
| 12 | Stage complete output and reserve a collision-safe filename. | Competing filename, cancellation, no-hard-link fallback and failed rename; foreign bytes preserved |
| 13 | Keep verified downloads complete after cleanup or notification failure. | Locked temp removal and throwing completion listener |
| 14 | Bound capture output, decode UTF-8 streams and reliably terminate hung processes. | 17 MiB output, timeout and split emoji bytes |
| 15 | Track media children, parse the final line at EOF and reject oversized lines. | Real child protocol fixture; tracked process and exact final bytes |
| 16 | Cancel browser media inspections after client disconnect. | Authenticated bridge request / disconnect / AbortSignal |
| 17 | Validate every batch URL before adding and deduplicate URLs. | Invalid second URL adds nothing; duplicate adds once |
| 18 | Handle malformed bridge request targets without an unhandled rejection. | Malformed HTTP target then successful health request |
| 19 | Reject invalid archive sizes, duplicate paths and oversized directory inventories. | Negative, non-finite and unsafe integer sizes; case collision and 10,001 directories |
| 20 | Stage media conversion and publish only successful output. | Encoder failure cleanup; success preserves original bytes |
| 21 | Deduplicate torrent selections and detach the caller array. | Duplicate selection and caller mutation; existing real torrent cases |
| 22 | Validate saved segment coverage and indices before trusting resumed bytes. | Overlapping persisted segments reset; final bytes match source |
| 23 | Keep late archive, torrent and crawler results bound to their original dialogs. | Electron UI close/reopen during delayed IPC; no stale updates or errors |

Completed 23 iterations. Backend verification: 77 tests passed, zero failures. Iteration 23 uses test/stability-ui.cjs against the actual Electron renderer with delayed IPC fault injection. Release integration and platform results are recorded in VERIFICATION.md.
